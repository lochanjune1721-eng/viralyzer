# Vendored: video-use (browser-use)

The editing engine in this directory is vendored from
https://github.com/browser-use/video-use (MIT, Copyright (c) 2026 Browser Use).
`helpers/` and `SKILL.md` are unmodified copies; the app drives them from
`src/lib/videouse/`.

- `helpers/transcribe.py`     ElevenLabs Scribe transcription (word-level, diarized, audio events)
- `helpers/pack_transcripts.py` phrase-level packed transcript
- `helpers/render.py`         EDL → per-segment extract (grade + 30ms fades) → lossless concat → subtitles LAST → loudnorm
- `helpers/grade.py`          colour grade presets and auto-grade analysis
- `helpers/timeline_view.py`  filmstrip + waveform + word labels PNG for any time range

Python 3.10+ with `pip install -r requirements.txt` is required (ffmpeg/ffprobe on PATH).
