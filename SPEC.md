# MeetMind API v1.0 Specification

## Goal

MeetMind API is the single backend entry point responsible for validating uploaded files before AI processing.

The API DOES NOT generate reports.

The API DOES NOT call GPT.

The API DOES NOT replace n8n.

Its responsibility is to decide:

- Can this file be processed?
- Does the user have enough minutes?
- Is the file supported?
- Is the file valid?

Only after a positive response may Mini App continue the existing processing pipeline.

---

# Current Architecture (DO NOT CHANGE)

Mini App

↓

Supabase Storage

↓

CloudConvert

↓

n8n

↓

Whisper

↓

GPT

↓

Telegram Report

Version 1.0 MUST NOT break or replace this pipeline.

---

# API Responsibilities v1.0

The API validates uploads before processing.

Responsibilities:

- validate supported format
- validate file size
- validate meeting duration
- validate remaining minutes
- return friendly messages
- centralize business rules

The API MUST NOT:

- generate reports
- modify GPT prompts
- replace CloudConvert
- replace n8n

---

# Supported Formats

Audio

- mp3
- m4a
- wav
- aac
- flac
- wma
- aiff

Video

- mp4
- mov
- webm

All other formats are rejected.

---

# Limits

Maximum file size

1 GB

Maximum meeting duration

90 minutes

---

# Remaining Minutes Formula

Current implementation:

remaining_minutes = minutes_limit - minutes_used

If the billing model changes in future, ONLY the API will change.

Mini App must never calculate remaining minutes.

---

# Request

POST /check-upload

Input

telegram_id

file_name

file_size_bytes

duration_seconds

format

---

# Successful Response

{
  "allowed": true,
  "remaining_minutes": 420,
  "required_minutes": 63,
  "after_processing": 357,
  "warning": false,
  "reason": "ok"
}

---

# Warning Response

{
  "allowed": true,
  "warning": true,
  "reason": "low_balance"
}

Shown to user:

⚠️ Less than 90 minutes remaining.
Consider topping up your balance.

---

# Error Responses

## Unsupported format

Reason

unsupported_format

User message

This file format isn't supported.
Please upload MP3, M4A, WAV, MP4 or WEBM.

---

## File too large

Reason

file_too_large

User message

File exceeds the 1 GB limit.
Please upload a smaller file.

---

## Meeting too long

Reason

duration_limit

User message

Meetings longer than 90 minutes aren't supported yet.

---

## No minutes left

Reason

zero_balance

User message

Your balance is empty.
Purchase minutes to continue.

---

## Not enough minutes

Reason

not_enough_minutes

User message

You don't have enough minutes for this meeting.
Purchase additional minutes to continue.

---

## User not found

Reason

user_not_found

User message

Please start the MeetMind bot first.

---

## Corrupted file

Reason

file_corrupted

User message

The file couldn't be read.
Please try another file.

---

## No audio

Reason

audio_track_missing

User message

No audio track found in the uploaded file.

---

## Duration unknown

Reason

duration_unknown

User message

Couldn't determine meeting duration.
Please try another file.

---

## CloudConvert failed

Reason

cloudconvert_failed

User message

Failed to prepare the recording.
Please try again.

---

## Temporary server error

Reason

server_error

User message

Temporary server error.
Please try again in a few minutes.

---

# Future v1.1

The API will later become responsible for:

- CloudConvert orchestration
- conversion settings
- file cleanup
- upload progress
- analytics
- promo codes
- referrals
- language selection
- authorization

Mini App should gradually become a thin client.

---

# Temporary Files Policy

Original uploaded files are temporary.

Converted MP3 files are temporary.

After successful Whisper processing:

- remove original file
- remove converted file

A scheduled cleanup task removes any temporary files older than 6 hours.

---

# Product Principle

Business logic belongs only in MeetMind API.

Mini App displays the interface.

n8n orchestrates AI processing.

CloudConvert converts files.

GPT generates reports.

This separation minimizes risk and simplifies future development.
