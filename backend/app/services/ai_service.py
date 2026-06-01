import json
import re
from openai import OpenAI
from app.config import get_settings

settings = get_settings()


class AIService:
    def __init__(self):
        self.client = OpenAI(
            api_key=settings.ai_api_key,
            base_url=settings.ai_base_url
        )
        self.model = settings.ai_model

    def generate_sentences(self, words: list[str], count: int = 10) -> list[dict]:
        """根据词汇生成句子"""

        words_str = ", ".join(words)

        prompt = f"""你是一个英语教师。请根据以下词汇生成{count}个英语句子：
词汇列表：{words_str}

要求：
1. 每个句子必须包含列表中的1-2个词汇
2. 句子难度：初级
3. 句长：8-15个单词
4. 语法正确、地道表达
5. 覆盖不同句型（陈述句、疑问句、祈使句）
6. **必须**每个句子提供准确的中文翻译，放在 chinese_text 字段
7. target_words 只包含词汇列表中的词，不要包含中文

输出格式（JSON数组，只输出JSON，不要其他内容）：
[
    {{"text": "The apple is red.", "chinese_text": "苹果是红色的。", "target_words": ["apple"]}},
    ...
]"""

        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": "你是一个英语教师。"},
                {"role": "user", "content": prompt}
            ],
            temperature=0.8,
            max_tokens=2000
        )

        content = response.choices[0].message.content.strip()

        # 去掉 MiniMax 的思考内容
        content = re.sub(r'<think>[\s\S]*?</think>', '', content).strip()

        sentences = []
        parsed = False

        # 尝试解析 JSON
        try:
            # 去掉可能的 markdown 代码块
            if content.startswith("```"):
                content = re.sub(r"^```json?\s*", "", content)
                content = re.sub(r"\s*```$", "", content)

            raw_sentences = json.loads(content)
            if isinstance(raw_sentences, list):
                sentences = raw_sentences
                parsed = True
        except json.JSONDecodeError:
            pass

        if not parsed:
            # 正则提取（包含 chinese_text）
            pattern = r'\{"text"\s*:\s*"([^"]+)"[^}]*"chinese_text"\s*:\s*"([^"]*)"[^}]*"target_words"\s*:\s*\[([^\]]+)\]'
            matches = re.findall(pattern, content)
            if matches:
                for match in matches:
                    words_list = [w.strip().strip('"') for w in match[2].split(',') if w.strip()]
                    sentences.append({
                        "text": match[0],
                        "chinese_text": match[1] if match[1] else "",
                        "target_words": words_list
                    })

        # 确保所有句子都有 chinese_text
        for s in sentences:
            if "chinese_text" not in s or not s["chinese_text"]:
                s["chinese_text"] = ""

        return sentences

    def validate_answer(self, correct_answer: str, user_input: str) -> bool:
        """校验用户答案"""
        # 标准化：转小写，去多余空格
        correct = correct_answer.lower().strip()
        user = user_input.lower().strip()

        # 去除英文标点符号（包括撇号）
        correct = re.sub(r"[.,!?;:'\"()\-—–]", '', correct).strip()
        user = re.sub(r"[.,!?;:'\"()\-—–]", '', user).strip()

        # 去除多余空格
        correct = re.sub(r'\s+', ' ', correct)
        user = re.sub(r'\s+', ' ', user)

        return correct == user


def get_ai_service() -> AIService:
    return AIService()
