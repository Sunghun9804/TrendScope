from typing import Dict
from fastapi import APIRouter

router = APIRouter(prefix="/api")

PRESS_LOGO_MAP = {
    "연합뉴스": "/view/img/연합뉴스_로고.png",
    "한국경제": "/view/img/한국경제_로고.png",
    "매일경제": "/view/img/매일경제_로고.png",
    "서울경제": "/view/img/서울경제_로고.png",
    "이데일리": "/view/img/이데일리_로고.png",
    "아시아경제": "/view/img/아시아경제_로고.png",
    "조선일보": "/view/img/조선일보_로고.png",
    "중앙일보": "/view/img/중앙일보_로고.png",
    "동아일보": "/view/img/동아일보_로고.png",
    "한겨레신문": "/view/img/한겨레신문_로고.png",
    "경향신문": "/view/img/경향신문_로고.png",
    "뉴스1": "/view/img/뉴스1_로고.png",
    "뉴시스": "/view/img/뉴시스_로고.png",
    "헤럴드경제": "/view/img/헤럴드경제_로고.png",
    "국민일보": "/view/img/국민일보_로고.png",
    "서울신문": "/view/img/서울신문_로고.png",
    "세계일보": "/view/img/세계일보_로고.png",
    "한겨레": "/view/img/한겨레_로고.png",
    "한국일보": "/view/img/한국일보_로고.png",
    "연합뉴스TV": "/view/img/연합뉴스TV_로고.png",
    "채널A": "/view/img/채널A_로고.png",
    "한국경제TV": "/view/img/한국경제TV_로고.png",
    "JTBC": "/view/img/JTBC_로고.png",
    "KBS": "/view/img/KBS_로고.png",
    "MBC": "/view/img/MBC_로고.png",
    "MBN": "/view/img/MBN_로고.png",
    "SBS": "/view/img/SBS_로고.png",
    "SBS Biz": "/view/img/SBS_Biz_로고.png",
    "TV조선": "/view/img/TV조선_로고.png",
    "YTN": "/view/img/YTN_로고.png",
    "머니투데이": "/view/img/머니투데이_로고.png",
    "비즈워치": "/view/img/비즈워치_로고.png",
    "조선비즈": "/view/img/조선비즈_로고.png",
    "조세일보": "/view/img/조세일보_로고.png",
    "파이낸셜뉴스": "/view/img/파이낸셜뉴스_로고.png",
    "노컷뉴스": "/view/img/노컷뉴스_로고.png",
    "더팩트": "/view/img/더팩트_로고.png",
    "데일리안": "/view/img/데일리안_로고.png",
    "머니S": "/view/img/머니S_로고.png",
    "미디어오늘": "/view/img/미디어오늘_로고.png",
    "아이뉴스24": "/view/img/아이뉴스24_로고.png",
    "오마이뉴스": "/view/img/오마이뉴스_로고.png",
    "프레시안": "/view/img/프레시안_로고.png", # 45개
    "디지털데일리": "/view/img/디지털데일리_로고.png",
    "디지털타임스": "/view/img/디지털타임스_로고.png",
    "블로터": "/view/img/블로터_로고.png",
    "전자신문": "/view/img/전자신문_로고.png",
    "더스쿠프": "/view/img/더스쿠프_로고.png",
    "레이디경향": "/view/img/레이디경향_로고.png",
    "매경이코노미": "/view/img/매경이코노미_로고.png",
    "시사IN": "/view/img/시사IN_로고.png",
    "시사저널": "/view/img/시사저널_로고.png",
    "신동아": "/view/img/신동아_로고.png",
    "이코노미스트": "/view/img/이코노미스트_로고.png",
    "주간경향": "/view/img/주간경향_로고.png",
    "주간동아": "/view/img/주간동아_로고.png",
    "주간조선": "/view/img/주간조선_로고.png",
    "중앙SUNDAY": "/view/img/중앙SUNDAY_로고.png",
    "한겨레21": "/view/img/한겨레21_로고.png",
    "한경비즈니스": "/view/img/한경비즈니스_로고.png",
    "농민신문": "/view/img/농민신문_로고.png",
    "여성신문": "/view/img/여성신문_로고.png",
    "코리아중앙데일리": "/view/img/코리아중앙데일리_로고.png",
    "코메디닷컴": "/view/img/코메디닷컴_로고.png",
    "강원도민일보": "/view/img/강원도민일보_로고.png",
    "강원일보": "/view/img/강원일보_로고.png",
    "경기일보": "/view/img/경기일보_로고.png",
    "국제신문": "/view/img/국제신문_로고.png",
    "대구MBC": "/view/img/대구MBC_로고.png",
    "대전일보": "/view/img/대전일보_로고.png",
    "매일신문": "/view/img/매일신문_로고.png",
    "부산일보": "/view/img/부산일보_로고.png",
    "CJB청주방송": "/view/img/CJB청주방송_로고.png",
    "JIBS": "/view/img/JIBS_로고.png",
    "kbc광주방송": "/view/img/kbc광주방송_로고.png",
    "문화일보": "/view/img/문화일보_로고.png", # 추가
    "스포츠경향": "/view/img/스포츠경향_로고.png", # 추가 (img 파일도 업데이트 됨)
    "스포츠조선": "/view/img/스포츠조선_로고.png", # 추가 (img 파일도 업데이트 됨)
    "스포츠서울": "/view/img/스포츠서울_로고.png",  # 추가 (img 파일도 업데이트 됨)
    "스포츠동아": "/view/img/스포츠동아_로고.jpg",  # 추가 (img 파일도 업데이트 됨)
}

DEFAULT_LOGO = "/view/img/favicon.png"

@router.get("/PRESS_LOGO")
def get_press_logo() -> Dict[str, str]:
    return PRESS_LOGO_MAP
