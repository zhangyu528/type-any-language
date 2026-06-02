"""
Tencent Cloud TTS service: generate audio for sentences using Tencent Cloud TTS.
Audio is saved to audio_dir and served via /audio/ endpoint.
"""
import base64
import hashlib
from pathlib import Path

from tencentcloud.common import credential
from tencentcloud.tts.v20190823.tts_client import TtsClient
from tencentcloud.tts.v20190823.models import TextToVoiceRequest

from app.config import get_settings

settings = get_settings()


def generate_audio(text: str, filename: str) -> str:
    """Generate MP3 audio for given text using Tencent Cloud TTS, save to audio_dir."""
    audio_dir = Path(settings.audio_dir)
    audio_dir.mkdir(parents=True, exist_ok=True)

    filepath = audio_dir / filename
    if filepath.exists():
        return str(filepath)

    cred = credential.Credential(
        settings.tencent_secret_id,
        settings.tencent_secret_key
    )
    client = TtsClient(cred, 'ap-guangzhou')

    req = TextToVoiceRequest()
    req.Text = text
    req.SessionId = f"session-{hashlib.md5(text.encode()).hexdigest()[:8]}"
    req.VoiceType = 1001  # en-US voice
    req.Volume = 0
    req.Speed = 0
    req.ProjectId = 0
    req.ModelType = 1

    resp = client.TextToVoice(req)
    audio_bytes = base64.b64decode(resp.Audio)

    with open(filepath, 'wb') as f:
        f.write(audio_bytes)

    return str(filepath)


def text_to_audio_filename(text: str) -> str:
    """Generate a safe filename from sentence text using MD5 hash."""
    hash_suffix = hashlib.md5(text.encode()).hexdigest()[:8]
    return f"{hash_suffix}.mp3"