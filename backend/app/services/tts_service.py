import base64
import uuid
import os

try:
    from tencentcloud.common.exception import TencentCloudSDKException
    from tencentcloud.tts.v20190823 import tts_client
    from tencentcloud.tts.v20190823 import models as tts_models
    from tencentcloud.common.profile.client_profile import ClientProfile
    from tencentcloud.common.credential import Credential
    TENcent_TTS_AVAILABLE = True
except ImportError:
    TencentCloudSDKException = None
    TENcent_TTS_AVAILABLE = False

from app.config import get_settings

settings = get_settings()


class TTSService:
    def __init__(self):
        if not TENcent_TTS_AVAILABLE:
            raise RuntimeError("Tencent Cloud TTS SDK not installed. Run: pip install tencentcloud-sdk-python")
        self.cred = Credential(settings.tencent_secret_id, settings.tencent_secret_key)
        self.profile = ClientProfile()
        self.profile.httpProfile.endpoint = "tts.tencentcloudapi.com"
        self.client = tts_client.TtsClient(self.cred, "ap-shanghai", self.profile)
        self.audio_dir = settings.audio_dir
        os.makedirs(self.audio_dir, exist_ok=True)

    def generate_audio(self, text: str) -> str:
        if not TENcent_TTS_AVAILABLE:
            return ""
        req = tts_models.TextToVoiceRequest()
        req.Text = text
        req.SessionId = str(uuid.uuid4())
        req.ModelType = 1
        req.VoiceType = 101004
        resp = self.client.TextToVoice(req)
        audio_data = base64.b64decode(resp.Audio)
        filename = f"{uuid.uuid4()}.wav"
        filepath = os.path.join(self.audio_dir, filename)
        with open(filepath, 'wb') as f:
            f.write(audio_data)
        return f"/audio/{filename}"


def get_tts_service() -> TTSService:
    if not TENcent_TTS_AVAILABLE:
        return None
    return TTSService()
