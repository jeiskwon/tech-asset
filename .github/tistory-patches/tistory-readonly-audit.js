/*
 tech-asset Tistory READ-ONLY inventory
 Purpose: export sanitized post/category/menu metadata from the BLOG OWNER'S logged-in browser.
 Restrictions: only GET to this same Tistory origin; no cookies/tokens/passwords collected or exported;
               never POST, PUT, PATCH, DELETE, never change visibility, skin or content.
 Updated: 2026-10-14
*/
(async function techAssetReadOnlyAudit() {
  "use strict";
  const ORIGIN = "https://tech-asset.tistory.com";
  if (location.origin !== ORIGIN || !location.pathname.startsWith("/manage")) {
    alert("이 점검 도구는 https://tech-asset.tistory.com/manage/posts 관리자 화면에서만 실행합니다.");
    return;
  }
  if (window.__techAssetAuditRunning) {
    alert("이미 점검 중입니다.");
    return;
  }
  window.__techAssetAuditRunning = true;
  const errors = [];
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function getJson(path) {
    if (!path.startsWith("/manage/") || path.includes("://")) {
      throw new Error("관리자 GET 경로만 허용합니다.");
    }
    const response = await fetch(ORIGIN + path, {
      method: "GET",
      credentials: "same-origin",
      redirect: "follow",
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error(path + " HTTP " + response.status);
    if (!response.url.startsWith(ORIGIN + "/manage/")) {
      throw new Error("관리자 세션이 만료되었거나 로그인 페이지로 이동했습니다.");
    }
    const type = response.headers.get("content-type") || "";
    if (!type.toLowerCase().includes("json")) {
      const body = await response.text();
      if (!body.trim().startsWith("{") && !body.trim().startsWith("[")) {
        throw new Error(path + " 에서 JSON 대신 HTML이 반환됐습니다.");
      }
      return JSON.parse(body);
    }
    return response.json();
  }

  function findArray(payload, keyNames) {
    const options = [payload, payload && payload.data, payload && payload.result];
    for (const root of options) {
      if (!root || typeof root !== "object") continue;
      if (Array.isArray(root)) return root;
      for (const key of keyNames) {
        if (Array.isArray(root[key])) return root[key];
      }
    }
    return null;
  }
  const str = val => val == null ? "" : String(val);
  const cleanPost = p => ({
    id: str(p.id),
    title: str(p.title),
    visibility: str(p.visibility),
    statusLabel: str(p.statusLabel),
    category: str(p.category),
    categoryId: str(p.categoryId),
    categoryVisibility: str(p.categoryVisibility),
    published: str(p.published),
    modified: str(p.modified),
    reservedDate: str(p.reservedDate),
    permalink: str(p.permalink),
    isScheduled: Boolean(p.isScheduled),
    isRestrict: Boolean(p.isRestrict),
    restrictLabel: str(p.restrictLabel)
  });

  function cleanCategory(node) {
    if (!node || typeof node !== "object") return null;
    return {
      id: str(node.id),
      name: str(node.name || node.label),
      visibility: node.visibility == null ? "" : String(node.visibility),
      entries: node.entries == null ? null : Number(node.entries),
      priority: node.priority == null ? null : Number(node.priority),
      children: (Array.isArray(node.children) ? node.children : [])
        .map(cleanCategory).filter(Boolean)
    };
  }
  const cleanMenu = m => ({
    id: str(m.id),
    name: str(m.name || m.title || m.label),
    type: str(m.type),
    url: str(m.url || m.link || m.href),
    categoryId: str(m.categoryId),
    visibility: str(m.visibility)
  });

  try {
    const posts = [];
    const seen = new Set();
    let stoppedReason = "maximum page limit reached";
    for (let page = 1; page <= 50; page++) {
      const path = "/manage/posts.json?category=-3&page=" + page +
        "&searchKeyword=&searchType=title&visibility=all";
      const data = await getJson(path);
      const entries = findArray(data, ["items", "posts", "list", "entries"]);
      if (!entries) {
        errors.push("posts.json 응답에서 글 목록 배열을 찾지 못했습니다. page=" + page +
          "; top-level keys=" + Object.keys(data || {}).slice(0, 12).join(","));
        stoppedReason = "unknown posts response structure";
        break;
      }
      if (entries.length === 0) {
        stoppedReason = "empty page " + page;
        break;
      }
      let added = 0;
      for (const post of entries) {
        if (!post || post.id == null) continue;
        const id = String(post.id);
        if (seen.has(id)) continue;
        seen.add(id);
        posts.push(cleanPost(post));
        added++;
      }
      if (added === 0) {
        stoppedReason = "repeated page " + page;
        break;
      }
      console.info("티스토리 점검: " + page + "페이지, 누적 " + posts.length + "개");
      await sleep(120);
    }

    let categories = [], menus = [], pages = [];
    try {
      const data = await getJson("/manage/category.json");
      const arr = findArray(data, ["categories", "categoryTree", "items"]);
      categories = (arr || []).map(cleanCategory).filter(Boolean);
      if (!arr) errors.push("카테고리 응답의 배열 구조를 확인할 수 없습니다.");
    } catch (error) {
      errors.push("카테고리 조회 실패: " + error.message);
    }
    try {
      const data = await getJson("/manage/design/menu.json");
      const arr = findArray(data, ["menus", "items", "menuList"]);
      menus = (arr || []).map(cleanMenu);
      if (!arr) errors.push("메뉴 응답의 배열 구조를 확인할 수 없습니다.");
    } catch (error) {
      errors.push("메뉴 조회 실패: " + error.message);
    }
    try {
      const data = await getJson("/manage/pages.json");
      const arr = findArray(data, ["items", "pages", "list"]);
      pages = (arr || []).map(p => ({
        id: str(p.id),
        title: str(p.title),
        visibility: str(p.visibility),
        permalink: str(p.permalink)
      }));
      if (!arr) errors.push("페이지 응답의 배열 구조를 확인할 수 없습니다.");
    } catch (error) {
      errors.push("페이지 조회 실패: " + error.message);
    }
    const byVisibility = {};
    for (const p of posts) byVisibility[p.visibility || "UNKNOWN"] =
      (byVisibility[p.visibility || "UNKNOWN"] || 0) + 1;
    const byCategory = {};
    for (const p of posts) byCategory[p.category || "카테고리 없음"] =
      (byCategory[p.category || "카테고리 없음"] || 0) + 1;

    const report = {
      tool: "tech-asset-tistory-readonly-audit",
      schemaVersion: "1.0",
      collectedAt: new Date().toISOString(),
      site: ORIGIN,
      readOnly: true,
      securityNote: "No cookies, passwords, access tokens or post bodies included. All requests were GET to same Tistory origin.",
      summary: { totalPosts: posts.length, byVisibility, byCategory, stoppedReason,
        categoryCount: categories.length, menuCount: menus.length, pageCount: pages.length },
      posts, categories, menus, pages, errors
    };
    window.__techAssetReadOnlyAudit = report;
    console.table([{ "글 수": posts.length, "공개": byVisibility.PUBLIC || 0,
      "비공개": byVisibility.PRIVATE || 0, "보호": byVisibility.PROTECTED || 0,
      "메뉴 수": menus.length, "오류": errors.length }]);
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: "application/json;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "tech-asset-tistory-audit-" +
      new Date().toISOString().slice(0, 10) + ".json";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    alert("읽기 전용 점검을 마쳤습니다. 다운로드된 JSON 파일을 채팅에 첨부해 주세요. 글 "
      + posts.length + "개, 오류 " + errors.length + "건.");
  } catch (error) {
    console.error("티스토리 읽기 전용 점검 실패:", error);
    alert("점검 중단: " + error.message +
      "\n게시글이나 설정은 수정하지 않았습니다. 오류 내용을 알려 주세요.");
  } finally {
    window.__techAssetAuditRunning = false;
  }
})();