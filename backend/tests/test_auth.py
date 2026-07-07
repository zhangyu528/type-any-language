"""
Auth endpoint tests — signup / login / logout / me.

Covers happy path + every documented error path (409 / 401 / 422 / 403).
The TestClient shares cookies across requests, so chains like
signup → me work without manual cookie plumbing.
"""


# ---------------------------------------------------------------------------
# signup
# ---------------------------------------------------------------------------
def test_signup_happy(client):
    """Valid signup → 200, returns user, sets tal_session cookie."""
    resp = client.post("/api/auth/signup", json={
        "email": "alice@example.com",
        "password": "verysecret123",
        "display_name": "Alice",
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["user"]["email"] == "alice@example.com"
    assert body["user"]["display_name"] == "Alice"
    assert body["user"]["is_active"] is True
    assert body["user"]["role"] is None  # not yet assigned
    assert body["user"]["tier"] is None  # not yet assigned
    assert "token" in body and body["token"]  # non-empty
    assert body["expires_in"] == 7 * 24 * 60 * 60
    assert "tal_session" in resp.cookies


def test_signup_duplicate_email(client):
    """Second signup with same email → 409."""
    payload = {
        "email": "bob@example.com",
        "password": "verysecret123",
        "display_name": "Bob",
    }
    assert client.post("/api/auth/signup", json=payload).status_code == 200
    dup = client.post("/api/auth/signup", json=payload)
    assert dup.status_code == 409
    assert dup.json()["detail"] == "Email already registered"


def test_signup_invalid_email(client):
    """Malformed email → 422 (Pydantic EmailStr)."""
    resp = client.post("/api/auth/signup", json={
        "email": "not-an-email",
        "password": "verysecret123",
        "display_name": "Charlie",
    })
    assert resp.status_code == 422


def test_signup_short_password(client):
    """Password under 8 chars → 422 (Pydantic min_length)."""
    resp = client.post("/api/auth/signup", json={
        "email": "d@example.com",
        "password": "short",
        "display_name": "Dave",
    })
    assert resp.status_code == 422


def test_signup_long_password(client):
    """Password over 72 chars (bcrypt input cap) → 422 (Pydantic max_length)."""
    resp = client.post("/api/auth/signup", json={
        "email": "e@example.com",
        "password": "x" * 73,
        "display_name": "Eve",
    })
    assert resp.status_code == 422


def test_signup_missing_display_name(client):
    """display_name field missing → 422."""
    resp = client.post("/api/auth/signup", json={
        "email": "f@example.com",
        "password": "verysecret123",
    })
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# login
# ---------------------------------------------------------------------------
def _signup(client, email: str, password: str, name: str):
    return client.post("/api/auth/signup", json={
        "email": email,
        "password": password,
        "display_name": name,
    })


def test_login_happy(client):
    """After signup, login with same creds → 200."""
    _signup(client, "frank@example.com", "verysecret123", "Frank")
    resp = client.post("/api/auth/login", json={
        "email": "frank@example.com",
        "password": "verysecret123",
    })
    assert resp.status_code == 200
    assert resp.json()["user"]["email"] == "frank@example.com"
    assert "tal_session" in resp.cookies


def test_login_wrong_password(client):
    """Wrong password → 401, same message as unknown email (no enumeration)."""
    _signup(client, "grace@example.com", "verysecret123", "Grace")
    resp = client.post("/api/auth/login", json={
        "email": "grace@example.com",
        "password": "wrongpassword",
    })
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid email or password"


def test_login_unknown_email(client):
    """Non-existent email → 401, same message."""
    resp = client.post("/api/auth/login", json={
        "email": "nobody@example.com",
        "password": "anypassword",
    })
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid email or password"


def test_login_case_insensitive_email(client):
    """Email lookup is case-insensitive (matches ix_users_email_lower)."""
    _signup(client, "hank@example.com", "verysecret123", "Hank")
    resp = client.post("/api/auth/login", json={
        "email": "HANK@EXAMPLE.COM",
        "password": "verysecret123",
    })
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# me
# ---------------------------------------------------------------------------
def test_me_without_cookie(client):
    """GET /me with no cookie → 401."""
    resp = client.get("/api/auth/me")
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Not authenticated"


def test_me_with_valid_cookie(client):
    """Signup then GET /me with the cookie it set → 200 + user."""
    _signup(client, "ivy@example.com", "verysecret123", "Ivy")
    resp = client.get("/api/auth/me")
    assert resp.status_code == 200
    body = resp.json()
    assert body["email"] == "ivy@example.com"
    assert body["display_name"] == "Ivy"


def test_me_with_garbage_cookie(client):
    """Tampered cookie value → 401 (JWT decode fails)."""
    client.cookies.set("tal_session", "garbage.value.here")
    resp = client.get("/api/auth/me")
    assert resp.status_code == 401


def test_me_with_wrong_secret_cookie(client):
    """JWT signed by a different secret → 401 (signature invalid)."""
    import jwt
    from datetime import datetime, timedelta, timezone
    forged = jwt.encode(
        {"sub": "00000000-0000-0000-0000-000000000000",
         "iat": int(datetime.now(timezone.utc).timestamp()),
         "exp": int((datetime.now(timezone.utc) + timedelta(days=1)).timestamp())},
        "different-secret",
        algorithm="HS256",
    )
    client.cookies.set("tal_session", forged)
    resp = client.get("/api/auth/me")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# logout
# ---------------------------------------------------------------------------
def test_logout_clears_cookie(client):
    """POST /logout → 204 + Set-Cookie header that clears tal_session.

    The Set-Cookie value has an empty token + Max-Age=0, which tells
    browsers (and our TestClient) to delete the cookie. The TestClient
    cookie jar filters out expired cookies, so we assert on the raw
    header instead of resp.cookies.
    """
    _signup(client, "jack@example.com", "verysecret123", "Jack")
    resp = client.post("/api/auth/logout")
    assert resp.status_code == 204
    set_cookie = resp.headers.get("set-cookie", "")
    assert "tal_session" in set_cookie
    # Set-Cookie should instruct the browser to delete the cookie
    # (Max-Age=0 + empty value). httpx stores "Max-Age=0" → the cookie
    # is removed from resp.cookies, but the raw header is still present.
    assert "Max-Age=0" in set_cookie or "max-age=0" in set_cookie.lower()


def test_logout_anonymous(client):
    """Logout without authentication → 204 (idempotent, never errors)."""
    resp = client.post("/api/auth/logout")
    assert resp.status_code == 204