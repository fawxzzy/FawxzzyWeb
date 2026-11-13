def load(p):
    raw = open(p, 'rb').read().decode('utf8')
    return raw.replace('\r\n', '\n'), '\r\n' in raw
def save(p, s, c):
    open(p, 'wb').write((s.replace('\n', '\r\n') if c else s).encode('utf8'))
def edit(p, pairs):
    s, c = load(p)
    for old, new in pairs:
        assert s.count(old) == 1, (p, old[:90], s.count(old))
        s = s.replace(old, new)
    save(p, s, c)
edit('docs/project-board-adapter.md', [(
"2. **Page.** `/projects` is a static, `noindex` shell with no board data (`OwnerProjectBoard`). After the browser Auth session is verified it fetches `GET /api/projects/board`, validates the snapshot through the board adapter (`buildOwnerBoardState`) and renders `ProjectBoard`. Signed out: a plain sign-in link (`/login?returnTo=%2Fprojects`). Signed in as another account, or any error: one neutral \"not available for this account\" message. Off the account origin the page is only a sign-in link to the account origin.",
"2. **Page.** `/projects` is a static, `noindex` shell with no board data and no copy about Projects (neutral title and description, nothing rendered while checking). `OwnerProjectBoard` waits for the browser Auth session, fetches `GET /api/projects/board`, validates the snapshot through the board adapter (`buildOwnerBoardState`) and renders `ProjectBoard`, setting the title `Projects | Fawxzzy` only then. Signed out on the account origin: redirect to `/login?returnTo=%2Fprojects`. Signed in as another account, or any error: the standard \"This page is not here.\" body (`NotFoundState`), indistinguishable from a missing page. Any other origin (main site, previews): redirect to `https://account.fawxzzy.com/projects`. `/operations` only forwards to `/projects`.")])
edit('docs/brand-and-app-origin-contract.md', [(
"only on the account origin, where the Auth session lives. The main site never shows the tab and\n`https://fawxzzy.com/projects` offers only a sign-in link to\n`https://account.fawxzzy.com/login?returnTo=%2Fprojects`. Auth state is not shared across\norigins.",
"only on the account origin, where the Auth session lives. The main site never shows the tab and\n`https://fawxzzy.com/projects` forwards to `https://account.fawxzzy.com/projects`, which sends a\nsigned-out visitor to sign in and shows every other account the standard not-found body. Auth state\nis not shared across origins.")])
edit('docs/test-contract-matrix.md', [(
"signed-out, other-account, outage and owner states; tab only for the verified owner; no request when signed out; main site shows only a sign-in link",
"signed-out (redirect to sign-in), other-account and outage (not-found body), owner states; tab only for the verified owner; no request when signed out; main site forwards to the account origin")])
