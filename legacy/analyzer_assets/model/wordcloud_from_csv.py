# ================================
# 워드클라우드 전용 스크립트
# ================================
import pandas as pd
import matplotlib.pyplot as plt
from wordcloud import WordCloud
from matplotlib import font_manager, rc
import os


# ================================
# 한글 폰트
# ================================
font_path = "C:/Windows/Fonts/malgun.ttf"
font_name = font_manager.FontProperties(fname=font_path).get_name()
rc("font", family=font_name)
plt.rcParams["axes.unicode_minus"] = False


# ================================
# 1. 사용할 issue_keyword
# ================================
issue = "정년연장"   # 여기만 바꾸면 됨

CSV_DIR = "saved_sub_keywords_csv"
csv_path = os.path.join(
    CSV_DIR,
    f"sub_keywords_{issue}.csv"
)


# ================================
# 2. CSV 로드
# ================================
df = pd.read_csv(csv_path)

# 워드클라우드용 상위 N개
df_wc = df.head(50)


# ================================
# 3. 워드클라우드 생성
# ================================
keyword_scores = dict(
    zip(df_wc["sub_keyword"], df_wc["tfidf_score"])
)

wordcloud = WordCloud(
    font_path=font_path,
    background_color="white",
    width=900,
    height=450
).generate_from_frequencies(keyword_scores)


# ================================
# 4. 출력
# ================================
plt.figure(figsize=(10, 5))
plt.imshow(wordcloud, interpolation="bilinear")
plt.axis("off")
plt.title(f"Issue Keyword: {issue}")
plt.show()
