# MeetMind Metadata Service

Preflight validation service for MeetMind AI.

## Current scope

- file format validation
- file size validation
- duration validation
- user balance validation
- low balance warnings
- localized error contracts

## Architecture

Mini App  
→ Metadata Service  
→ existing pipeline:

Supabase Storage  
→ CloudConvert  
→ n8n  
→ Whisper  
→ GPT

## Status

Current implementation stage:

- [x] Specification
- [ ] Health endpoint
- [ ] Supabase user lookup
- [ ] Balance calculation
- [ ] File validation
- [ ] Mini App integration
