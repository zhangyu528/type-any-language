"""
Protected route tests — /api/history is the v1 auth-gate placeholder.

The deliverable here is the gate: prove that
  - without a cookie, the request bounces with 401
  - with a valid cookie, the request returns the placeholder payload

Real history data lands in a later PR.
"""


def test_history_without_cookie(client):
    """No cookie → 401."""
    resp = client.get("/api/history")
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Not authenticated"


def test_history_with_valid_cookie(client):
    """Signup then GET /api/history → 200 + placeholder payload."""
    client.post("/api/auth/signup", json={
        "email": "kim@example.com",
        "password": "verysecret123",
        "display_name": "Kim",
    })
    resp = client.get("/api/history")
    assert resp.status_code == 200
    body = resp.json()
    assert body["items"] == []
    assert body["user"]["email"] == "kim@example.com"
    assert body["user"]["display_name"] == "Kim"


def test_history_with_garbage_cookie(client):
    """Tampered cookie → 401."""
    client.cookies.set("tal_session", "garbage.value.here")
    resp = client.get("/api/history")
    assert resp.status_code == 401