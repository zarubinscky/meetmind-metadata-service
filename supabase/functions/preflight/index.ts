import { createClient } from "npm:@supabase/supabase-js@2";

const MAX_FILE_SIZE_BYTES = 1024 * 1024 * 1024; // 1 ГБ
const MAX_DURATION_MINUTES = 90;
const LOW_BALANCE_THRESHOLD_MINUTES = 90;

const SUPPORTED_FORMATS = new Set([
  "mp3",
  "m4a",
  "wav",
  "aac",
  "aiff",
  "flac",
  "wma",
  "ogg",
  "mp4",
  "mov",
  "webm",
]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function getFileExtension(fileName: string): string {
  const parts = fileName.trim().toLowerCase().split(".");

  if (parts.length < 2) {
    return "";
  }

  return parts.at(-1) ?? "";
}

Deno.serve(async (request: Request) => {
  console.log("MEETMIND PREFLIGHT V1.2");

  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method === "GET") {
    return jsonResponse({
      ok: true,
      service: "meetmind-metadata-service",
      version: "1.2.0",
      timestamp: new Date().toISOString(),
    });
  }

  if (request.method !== "POST") {
    return jsonResponse(
      {
        ok: false,
        allowed: false,
        reason: "method_not_allowed",
        message: "Используйте POST-запрос.",
      },
      405,
    );
  }

  try {
    const body = await request.json().catch(() => null);

    const mode = String(body?.mode ?? "initial_check");

if (mode === "duration_check") {
  const telegramId = body?.telegram_id;
  const durationSeconds = Number(body?.duration_seconds);

  if (
    telegramId === undefined ||
    telegramId === null ||
    String(telegramId).trim() === ""
  ) {
    return jsonResponse(
      {
        ok: false,
        allowed: false,
        code: "TELEGRAM_ID_REQUIRED",
        action: {
          type: "restart_app",
        },
        ui: {
          title: "Не удалось определить пользователя.",
          action: "Перезапустите приложение.",
        },
      },
      400,
    );
  }

  /*
   * Внутренняя ошибка определения длительности
   * НЕ блокирует клиентский путь.
   */
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return jsonResponse({
      ok: true,
      allowed: true,
      code: "DURATION_CHECK_SKIPPED",
      degraded_mode: true,
      action: {
        type: "continue_processing",
      },
      ui: {
        title: "Продолжаем обработку записи.",
        action: "Пожалуйста, подождите.",
      },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    /*
     * Внутренняя проблема сервера также не должна
     * блокировать рабочий pipeline.
     */
    console.error("SUPABASE_ENV_NOT_CONFIGURED_DURATION_CHECK");

    return jsonResponse({
      ok: true,
      allowed: true,
      code: "BALANCE_CHECK_SKIPPED",
      degraded_mode: true,
      action: {
        type: "continue_processing",
      },
      ui: {
        title: "Продолжаем обработку записи.",
        action: "Пожалуйста, подождите.",
      },
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data: user, error } = await supabase
    .from("users")
    .select(
      "telegram_id, plan, minutes_limit, minutes_used, paid_minutes, subscription_until, language",
    )
    .eq("telegram_id", telegramId)
    .maybeSingle();

  if (error || !user) {
    console.error("DURATION_USER_LOOKUP_FAILED", error);

    /*
     * Ошибка нашей инфраструктуры — пропускаем дальше.
     * Пользователя не блокируем.
     */
    return jsonResponse({
      ok: true,
      allowed: true,
      code: "BALANCE_CHECK_SKIPPED",
      degraded_mode: true,
      action: {
        type: "continue_processing",
      },
      ui: {
        title: "Продолжаем обработку записи.",
        action: "Пожалуйста, подождите.",
      },
    });
  }

  const durationMinutes = Math.ceil(durationSeconds / 60);
  const minutesLimit = Number(user.minutes_limit ?? 0);
  const minutesUsed = Number(user.minutes_used ?? 0);
  const remainingMinutes = Math.max(0, minutesLimit - minutesUsed);

  if (durationMinutes > MAX_DURATION_MINUTES) {
    return jsonResponse({
      ok: true,
      allowed: false,
      code:  "FILE_TOO_LONG",
      duration: {
        seconds: durationSeconds,
        required_minutes: durationMinutes,
      },
      limits: {
        max_duration_minutes: MAX_DURATION_MINUTES,
      },
      action: {
        type: "choose_another_file",
      },
      ui: {
        title: "Запись длиннее 90 минут.",
        action: "Выберите более короткий файл.",
      },
    });
  }

  if (remainingMinutes === 0) {
    return jsonResponse({
      ok: true,
      allowed: false,
      code: "ZERO_BALANCE",
      duration: {
        seconds: durationSeconds,
        required_minutes: durationMinutes,
      },
      balance: {
        remaining_minutes: 0,
      },
      action: {
        type: "top_up",
      },
      ui: {
        title: "Минуты закончились.",
        action: "Пополните баланс.",
      },
    });
  }

  if (remainingMinutes < durationMinutes) {
    return jsonResponse({
      ok: true,
      allowed: false,
      code: "INSUFFICIENT_MINUTES",
      duration: {
        seconds: durationSeconds,
        required_minutes: durationMinutes,
      },
      balance: {
        remaining_minutes: remainingMinutes,
        missing_minutes: durationMinutes - remainingMinutes,
      },
      action: {
        type: "top_up",
      },
      ui: {
        title: "Недостаточно минут.",
        action: "Пополните баланс.",
      },
    });
  }

  const afterProcessingMinutes = remainingMinutes - durationMinutes;
  const lowBalance = afterProcessingMinutes < 90;

  return jsonResponse({
    ok: true,
    allowed: true,
    code: lowBalance ? "ALLOWED_LOW_BALANCE" : "ALLOWED",
    duration: {
      seconds: durationSeconds,
      required_minutes: durationMinutes,
    },
    balance: {
      remaining_minutes: remainingMinutes,
      after_processing_minutes: afterProcessingMinutes,
      is_low_after_processing: lowBalance,
    },
    action: {
      type: lowBalance ? "continue_and_offer_top_up" : "continue_processing",
    },
    ui: lowBalance
      ? {
          title: "Файл принят в обработку.",
          action: "После обработки пополните минуты.",
        }
      : {
          title: "Файл принят в обработку.",
          action: "Пожалуйста, подождите.",
        },
  });
}

    const telegramId = body?.telegram_id;
    const fileName = String(body?.file_name ?? "").trim();
    const fileSizeBytes = Number(body?.file_size_bytes);
    const mimeType = body?.mime_type
      ? String(body.mime_type).trim().toLowerCase()
      : null;

    if (
      telegramId === undefined ||
      telegramId === null ||
      String(telegramId).trim() === ""
    ) {
      return jsonResponse(
        {
          ok: false,
          allowed: false,
          reason: "telegram_id_required",
          message:
            "Не удалось определить пользователя. Перезапустите приложение.",
        },
        400,
      );
    }

    if (!fileName) {
      return jsonResponse(
        {
          ok: false,
          allowed: false,
          reason: "file_name_required",
          message: "Не удалось определить файл. Выберите его ещё раз.",
        },
        400,
      );
    }

    if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
      return jsonResponse(
        {
          ok: false,
          allowed: false,
          reason: "invalid_file_size",
          message: "Не удалось определить размер файла. Выберите его ещё раз.",
        },
        400,
      );
    }

    const fileFormat = getFileExtension(fileName);

    if (!fileFormat || !SUPPORTED_FORMATS.has(fileFormat)) {
      return jsonResponse(
        {
          ok: false,
          allowed: false,
          reason: "unsupported_format",
          message:
            "Этот формат не поддерживается. Выберите MP3, M4A, WAV, AAC, AIFF, FLAC, WMA, OGG, MP4, MOV или WEBM.",
          action: "choose_another_file",
          supported_formats: Array.from(SUPPORTED_FORMATS),
        },
        400,
      );
    }

    if (fileSizeBytes > MAX_FILE_SIZE_BYTES) {
      return jsonResponse(
        {
          ok: false,
          allowed: false,
          reason: "file_too_large",
          message: "Файл больше 1 ГБ. Выберите файл меньшего размера.",
          action: "choose_another_file",
          limits: {
            max_file_size_bytes: MAX_FILE_SIZE_BYTES,
            max_file_size_mb: 1024,
          },
        },
        400,
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("SUPABASE_ENV_NOT_CONFIGURED");

      return jsonResponse(
        {
          ok: false,
          allowed: false,
          reason: "server_error",
          message: "Сервис временно недоступен. Попробуйте ещё раз.",
        },
        500,
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data: user, error } = await supabase
      .from("users")
      .select(
        "telegram_id, plan, minutes_limit, minutes_used, paid_minutes, subscription_until, language",
      )
      .eq("telegram_id", telegramId)
      .maybeSingle();

    if (error) {
      console.error("USER_LOOKUP_FAILED", error);

      return jsonResponse(
        {
          ok: false,
          allowed: false,
          reason: "user_lookup_failed",
          message: "Не удалось проверить баланс. Попробуйте ещё раз.",
        },
        500,
      );
    }

    if (!user) {
      return jsonResponse(
        {
          ok: false,
          allowed: false,
          reason: "user_not_found",
          message: "Пользователь не найден. Сначала запустите бота.",
          action: "open_bot",
        },
        404,
      );
    }

    const minutesLimit = Number(user.minutes_limit ?? 0);
    const minutesUsed = Number(user.minutes_used ?? 0);
    const remainingMinutes = Math.max(0, minutesLimit - minutesUsed);

    if (remainingMinutes === 0) {
      return jsonResponse(
        {
          ok: true,
          allowed: false,
          reason: "zero_balance",
          message: "Минуты закончились. Пополните баланс для обработки файла.",
          action: "top_up",
          file: {
            name: fileName,
            format: fileFormat,
            mime_type: mimeType,
            size_bytes: fileSizeBytes,
            size_mb: Number((fileSizeBytes / 1024 / 1024).toFixed(1)),
          },
          balance: {
            remaining_minutes: 0,
          },
        },
        200,
      );
    }

    return jsonResponse({
      ok: true,
      allowed: true,
      reason:
        remainingMinutes < LOW_BALANCE_THRESHOLD_MINUTES
          ? "low_balance"
          : "ready_for_duration_check",
      message:
        remainingMinutes < LOW_BALANCE_THRESHOLD_MINUTES
          ? "На балансе меньше 90 минут. Рекомендуем пополнить его."
          : "Файл прошёл первичную проверку.",
      service: "meetmind-metadata-service",
      version: "1.2.0",
      user: {
        telegram_id: String(user.telegram_id),
        plan: user.plan ?? null,
        language: user.language ?? null,
        subscription_until: user.subscription_until ?? null,
      },
      file: {
        name: fileName,
        format: fileFormat,
        mime_type: mimeType,
        size_bytes: fileSizeBytes,
        size_mb: Number((fileSizeBytes / 1024 / 1024).toFixed(1)),
        supported: true,
        size_ok: true,
      },
      balance: {
        minutes_limit: minutesLimit,
        minutes_used: minutesUsed,
        paid_minutes: Number(user.paid_minutes ?? 0),
        remaining_minutes: remainingMinutes,
        is_zero: false,
        is_low: remainingMinutes < LOW_BALANCE_THRESHOLD_MINUTES,
      },
      limits: {
        max_file_size_bytes: MAX_FILE_SIZE_BYTES,
        max_file_size_mb: 1024,
        max_duration_minutes: MAX_DURATION_MINUTES,
      },
      next: "duration_check",
    });
  } catch (error) {
    console.error("PREFLIGHT_ERROR", error);

    return jsonResponse(
      {
        ok: false,
        allowed: false,
        reason: "server_error",
        message: "Сервис временно недоступен. Попробуйте ещё раз.",
      },
      500,
    );
  }
});
