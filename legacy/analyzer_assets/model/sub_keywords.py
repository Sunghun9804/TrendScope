# ================================
# 0. 라이브러리
# ================================
import re
import time
import pandas as pd
from collections import defaultdict
from konlpy.tag import Okt
from sklearn.feature_extraction.text import TfidfVectorizer
import os

start_time = time.time()

# ================================
# 1. 데이터 로드
# ================================
df = pd.read_csv("data/news_with_issue1212.csv")
df = df.dropna(subset=["issue_keyword", "content"])


# ================================
# 2. 형태소 분석
# ================================
okt = Okt()

def extract_nouns(text):
    text = re.sub(r"[^가-힣\s]", " ", text)
    return " ".join(okt.nouns(text))

df["noun_content"] = df["content"].apply(extract_nouns)


# ================================
# 3. 전체 corpus 기준 IDF
# ================================
global_vectorizer = TfidfVectorizer()
global_vectorizer.fit(df["noun_content"])

global_idf = dict(
    zip(
        global_vectorizer.get_feature_names_out(),
        global_vectorizer.idf_
    )
)


# ================================
# 4. 단어별 등장 이슈 수
# ================================
word_issue_map = defaultdict(set)

for issue in df["issue_keyword"].unique():
    words = set(
        df[df["issue_keyword"] == issue]["noun_content"]
        .str.split()
        .sum()
    )
    for w in words:
        word_issue_map[w].add(issue)

word_issue_count = {
    w: len(issues) for w, issues in word_issue_map.items()
}

ISSUE_THRESHOLD = len(df["issue_keyword"].unique()) * 0.7


# ================================
# 5. 단위/수치 접미사
# ================================
unit_suffixes = (
    "원", "억원", "조원", "만원",
    "명", "인", "건",
    "년", "개월", "월", "일",
    "퍼센트", "비율"
)


# ================================
# 6. 저장 폴더 설정 ⭐⭐⭐
# ================================
SAVE_DIR = "saved_sub_keywords_csv"
os.makedirs(SAVE_DIR, exist_ok=True)


# ================================
# 7. issue_keyword별 하위키워드 CSV 저장
# ================================
for issue in df["issue_keyword"].unique():
    subset = df[df["issue_keyword"] == issue]

    if len(subset) < 3:
        continue

    documents = subset["noun_content"].tolist()

    vectorizer = TfidfVectorizer(max_features=500)
    tfidf_matrix = vectorizer.fit_transform(documents)

    words = vectorizer.get_feature_names_out()
    scores = tfidf_matrix.mean(axis=0).A1

    keyword_df = pd.DataFrame({
        "sub_keyword": words,
        "tfidf_score": scores
    })

    # 자동 정제
    keyword_df = keyword_df[keyword_df["sub_keyword"].str.len() > 1]
    keyword_df = keyword_df[
        keyword_df["sub_keyword"].apply(
            lambda x: global_idf.get(x, 0) > 1.5
        )
    ]
    keyword_df = keyword_df[
        ~keyword_df["sub_keyword"].str.endswith(unit_suffixes)
    ]
    keyword_df = keyword_df[
        keyword_df["sub_keyword"].apply(
            lambda x: word_issue_count.get(x, 0) < ISSUE_THRESHOLD
        )
    ]

    keyword_df = keyword_df.sort_values(
        by="tfidf_score", ascending=False
    )

    save_path = os.path.join(
        SAVE_DIR,
        f"sub_keywords_{issue}.csv"
    )

    keyword_df.to_csv(
        save_path,
        index=False,
        encoding="utf-8-sig"
    )

print("하위키워드 CSV 저장 완료")

end_time = time.time()
elapsed_time = end_time - start_time

print("\n==============================")
print(f"전체 실행 시간: {elapsed_time:.2f}초")
print("==============================")
