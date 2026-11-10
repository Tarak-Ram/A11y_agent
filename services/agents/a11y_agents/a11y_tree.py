"""Accessibility-tree view of a page, as a screen reader would present it.

Built from Chrome's real accessibility tree (CDP) so names/roles are what assistive
tech gets, not what the DOM looks like. Each actionable node gets a short ref
(e1, e2, ...) mapped to a CSS selector, so agents can act and report without pixels.
"""
from __future__ import annotations

from playwright.async_api import CDPSession, Page

SKIP_ROLES = {"none", "generic", "InlineTextBox", "LineBreak", "RootWebArea", "WebArea", "presentation"}
TEXT_PARENTS_SKIP = {"link", "button", "heading", "StaticText", "label", "LabelText", "menuitem", "tab", "option", "cell", "columnheader", "rowheader", "listitem"}
SHOWN_PROPS = {"focusable", "disabled", "checked", "expanded", "selected", "required", "invalid", "level", "url"}

SELECTOR_JS = """function() {
  const el = this;
  if (el.id) return '#' + CSS.escape(el.id);
  const parts = []; let n = el;
  while (n && n.nodeType === 1 && n !== document.documentElement) {
    let s = n.nodeName.toLowerCase();
    if (n.id) { parts.unshift('#' + CSS.escape(n.id)); break; }
    const p = n.parentElement;
    if (p) {
      const same = [...p.children].filter(c => c.nodeName === n.nodeName);
      if (same.length > 1) s += ':nth-of-type(' + (same.indexOf(n) + 1) + ')';
    }
    parts.unshift(s); n = p;
  }
  return parts.join(' > ');
}"""

FOCUSED_JS = """() => {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return null;
  const path = (n) => {
    if (n.id) return '#' + CSS.escape(n.id);
    const parts = [];
    while (n && n.nodeType === 1 && n !== document.documentElement) {
      let s = n.nodeName.toLowerCase();
      if (n.id) { parts.unshift('#' + CSS.escape(n.id)); break; }
      const p = n.parentElement;
      if (p) { const same = [...p.children].filter(c => c.nodeName === n.nodeName);
               if (same.length > 1) s += ':nth-of-type(' + (same.indexOf(n) + 1) + ')'; }
      parts.unshift(s); n = p;
    }
    return parts.join(' > ');
  };
  return { selector: path(el), tag: el.tagName.toLowerCase(), text: (el.innerText || el.value || '').slice(0, 80) };
}"""


class AXView:
    def __init__(self, page: Page):
        self.page = page
        self.refs: dict[str, str] = {}  # ref -> css selector
        self._cdp: CDPSession | None = None

    async def _session(self) -> CDPSession:
        if self._cdp is None:
            self._cdp = await self.page.context.new_cdp_session(self.page)
            await self._cdp.send("Accessibility.enable")
            await self._cdp.send("DOM.enable")
            await self._cdp.send("Runtime.enable")
        return self._cdp

    async def _selector_for(self, cdp: CDPSession, backend_id: int) -> str:
        try:
            obj = (await cdp.send("DOM.resolveNode", {"backendNodeId": backend_id}))["object"]
            res = await cdp.send(
                "Runtime.callFunctionOn",
                {"objectId": obj["objectId"], "functionDeclaration": SELECTOR_JS, "returnByValue": True},
            )
            return res["result"].get("value", "")
        except Exception:
            return ""

    async def snapshot(self, max_nodes: int = 250) -> str:
        cdp = await self._session()
        nodes = (await cdp.send("Accessibility.getFullAXTree"))["nodes"]
        by_id = {n["nodeId"]: n for n in nodes}
        self.refs = {}
        lines: list[str] = []
        count = 0

        def val(x):
            return (x or {}).get("value", "")

        async def walk(node_id: str, depth: int, parent_role: str):
            nonlocal count
            n = by_id.get(node_id)
            if not n or count >= max_nodes:
                return
            role, name = val(n.get("role")), val(n.get("name"))
            ignored = n.get("ignored", False)
            next_depth, next_role = depth, parent_role
            if not ignored and role not in SKIP_ROLES:
                if role == "StaticText":
                    if name.strip() and parent_role not in TEXT_PARENTS_SKIP:
                        lines.append(f'{"  " * depth}text "{name.strip()[:200]}"')
                        count += 1
                else:
                    props = {p["name"]: val(p["value"]) for p in n.get("properties", [])}
                    shown = " ".join(
                        f"[{k}={v}]" if k in {"level", "url"} else f"[{k}]" if v is True else f"[{k}={v}]"
                        for k, v in props.items()
                        if k in SHOWN_PROPS and v not in (False, "", None) and not (k == "focusable" and role in ("link", "button"))
                    )
                    ref = ""
                    if n.get("backendDOMNodeId") and (props.get("focusable") or role in ("img", "heading", "main", "navigation", "form", "banner", "contentinfo", "region")):
                        sel = await self._selector_for(cdp, n["backendDOMNodeId"])
                        if sel:
                            ref = f"e{len(self.refs) + 1}"
                            self.refs[ref] = sel
                    nm = f' "{name[:120]}"' if name else " (NO ACCESSIBLE NAME)" if props.get("focusable") or role in ("img",) else ""
                    lines.append(f'{"  " * depth}{role}{nm}{" " + shown if shown else ""}{" ref=" + ref if ref else ""}')
                    count += 1
                    next_depth, next_role = depth + 1, role
            for cid in n.get("childIds", []):
                await walk(cid, next_depth, next_role)

        roots = [n["nodeId"] for n in nodes if not n.get("parentId")]
        for r in roots:
            await walk(r, 0, "")
        title = await self.page.title()
        header = f"page: {title!r} url={self.page.url}"
        if count >= max_nodes:
            header += f"  (truncated at {max_nodes} nodes; scroll for more)"
        return header + "\n" + "\n".join(lines)

    async def focused(self) -> dict | None:
        return await self.page.evaluate(FOCUSED_JS)

    def resolve(self, ref_or_selector: str) -> str:
        return self.refs.get(ref_or_selector, ref_or_selector)
