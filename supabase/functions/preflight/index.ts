import { createClient } from "npm:@supabase/supabase-js@2";

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

function getServerKey(): string {
  // Новый формат ключей Supabase
  const secretKeysJson = Deno.env.get("SUPABASE_SECRET_KEYS");

  if (secretKeysJson) {
    const secretKeys = JSON.parse(secretKeysJson);
    const firstKey = Object.values(secretKeys)[0];

    if (typeof firstKey === "string" && firstKey.length > 0) {
      return firstKey;
    }
  }

  // Совместимость с legacy-проектами
  const legacyKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SECRET_KEY");

  if (!legacyKey) {
    throw new Error("SUPABASE_SERVER_KEY_NOT_CONFIGURED");
  }

  return legacyKey;
}

Deno.serve(async (request: Request) => {
  console.log("MEETMIND PREFLIGHT V1.1");

  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Открытие ссылки в браузере остаётся healthcheck
  if (request.method === "GET") {
    return jsonResponse({
      ok: true,
      service: "meetmind-metadata-service",
      version: "1.1.0",
      timestamp: new Date().toISOString(),
    });
  }

  if (request.method !== "POST") {
    return jsonResponse(
      {
        ok: false,
        code: "METHOD_NOT_ALLOWED",
        message: "Используйте POST-запрос.",
      },
      405,
    );
  }

  try {
    const body = await request.json().catch(() => null);
    const telegramId = body?.telegram_id;

    if (
      telegramId === undefined ||
      telegramId === null ||
      String(telegramId).trim() === ""
    ) {
      return jsonResponse(
        {
          ok: false,
          code: "TELEGRAM_ID_REQUIRED",
          message: "Не удалось определить пользователя. Перезапустите приложение.",
        },
        400,
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");

    if (!supabaseUrl) {
      throw new Error("SUPABASE_URL_NOT_CONFIGURED");
    }

    const supabase = createClient(supabaseUrl, getServerKey(), {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data: user, error } = await supabase
      .from("users")
      .select(
        "telegram_id, plan, minutes_limit, minutes_used, paid_minutes, subscription_until",
      )
      .eq("telegram_id", String(telegramId))
      .maybeSingle();

    if (error) {
      console.error("USER_LOOKUP_ERROR", error);

      return jsonResponse(
        {
          ok: false,
          code: "USER_LOOKUP_FAILED",
          message: "Не удалось проверить баланс. Попробуйте ещё раз.",
        },
        500,
      );
    }

    if (!user) {
      return jsonResponse(
        {
          ok: false,
          code: "USER_NOT_FOUND",
          message: "Пользователь не найден. Сначала запустите бота.",
        },
        404,
      );
    }

    const minutesLimit = Number(user.minutes_limit ?? 0);
    const minutesUsed = Number(user.minutes_used ?? 0);
    const remainingMinutes = Math.max(0, minutesLimit - minutesUsed);

    return jsonResponse({
      ok: true,
      service: "meetmind-metadata-service",
      version: "1.1.0",
      user: {
        telegram_id: String(user.telegram_id),
        plan: user.plan ?? null,
        minutes_limit: minutesLimit,
        minutes_used: minutesUsed,
        paid_minutes: Number(user.paid_minutes ?? 0),
        remaining_minutes: remainingMinutes,
        subscription_until: user.subscription_until ?? null,
      },
      balance: {
        is_zero: remainingMinutes <= 0,
        is_low: remainingMinutes > 0 && remainingMinutes < 90,
      },
    });
  } catch (error) {
    console.error("PREFLIGHT_ERROR", error);

    return jsonResponse(
      {
        ok: false,
        code: "INTERNAL_ERROR",
        message: "Сервис временно недоступен. Попробуйте ещё раз.",
      },
      500,
    );
  }
});
