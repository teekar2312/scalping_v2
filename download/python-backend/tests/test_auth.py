"""
test_auth.py
=============
Unit tests for the API key auth + role-based access (Sprint 5 #1, #6).

Tests use the isolated_db fixture so user rows don't collide with the prod
database.
"""
from __future__ import annotations

import pytest

from auth import (
    APIKeyAuth, get_auth, hash_password, verify_password,
    generate_api_key, login, LoginResult, require_role,
)
import database as db


# --------------------------------------------------------------------------- #
# APIKeyAuth
# --------------------------------------------------------------------------- #

class TestAPIKeyAuth:
    def test_disabled_when_no_keys(self):
        """Empty key list => auth disabled."""
        auth = APIKeyAuth(valid_keys=[])
        assert auth.enabled is False

    def test_enabled_with_keys(self):
        auth = APIKeyAuth(valid_keys=["sk_a", "sk_b"])
        assert auth.enabled is True
        assert "sk_a" in auth.valid_keys

    def test_verify_static_key(self, isolated_db, monkeypatch):
        """A valid static key should authenticate as ADMIN."""
        auth = APIKeyAuth(valid_keys=["sk_test_static"])

        class FakeRequest:
            headers = {"Authorization": "Bearer sk_test_static"}
        res = auth.verify(FakeRequest())  # type: ignore[arg-type]
        assert res["authenticated"] is True
        assert res["user"]["role"] == "ADMIN"

    def test_verify_missing_header(self, isolated_db):
        auth = APIKeyAuth(valid_keys=["sk_x"])

        class FakeRequest:
            headers = {}
        res = auth.verify(FakeRequest())  # type: ignore[arg-type]
        assert res["authenticated"] is False

    def test_verify_invalid_token(self, isolated_db):
        auth = APIKeyAuth(valid_keys=["sk_x"])

        class FakeRequest:
            headers = {"Authorization": "Bearer sk_invalid"}
        res = auth.verify(FakeRequest())  # type: ignore[arg-type]
        assert res["authenticated"] is False

    def test_verify_user_api_key_from_db(self, isolated_db):
        """A user's API key (from /api/auth/login) should authenticate."""
        auth = APIKeyAuth(valid_keys=[])
        # Create a user with a known API key
        from auth import hash_password, generate_api_key
        user_id = db.create_user(
            username="trader1",
            password_hash=hash_password("secret"),
            role="TRADER",
            api_key="sk_user_trader1",
        )
        # Auth is "disabled" because valid_keys is empty, but verify_user_api_key
        # should still work in the enabled branch via get_user_by_api_key.
        auth.enabled = True  # simulate API_KEYS env var set
        try:
            class FakeRequest:
                headers = {"Authorization": "Bearer sk_user_trader1"}
            res = auth.verify(FakeRequest())  # type: ignore[arg-type]
            assert res["authenticated"] is True
            assert res["user"]["role"] == "TRADER"
            assert res["user"]["username"] == "trader1"
        finally:
            auth.enabled = False


# --------------------------------------------------------------------------- #
# Password hashing
# --------------------------------------------------------------------------- #

class TestPasswordHash:
    def test_hash_and_verify_round_trip(self):
        h = hash_password("mysecret")
        assert h != "mysecret"
        assert verify_password("mysecret", h) is True

    def test_wrong_password_fails(self):
        h = hash_password("mysecret")
        assert verify_password("wrong", h) is False

    def test_empty_password_raises(self):
        with pytest.raises(ValueError):
            hash_password("")


# --------------------------------------------------------------------------- #
# generate_api_key
# --------------------------------------------------------------------------- #

def test_generate_api_key_format():
    key = generate_api_key()
    assert key.startswith("sk_")
    # sk_ + 64 hex chars (32 bytes)
    assert len(key) == 3 + 64


def test_generate_api_key_unique():
    a = generate_api_key()
    b = generate_api_key()
    assert a != b


# --------------------------------------------------------------------------- #
# login flow
# --------------------------------------------------------------------------- #

class TestLogin:
    def test_login_success(self, isolated_db):
        # Pre-create the user
        h = hash_password("secret123")
        db.create_user(username="alice", password_hash=h, role="TRADER")
        res = login("alice", "secret123")
        assert res.ok is True
        assert res.api_key is not None
        assert res.role == "TRADER"

    def test_login_wrong_password(self, isolated_db):
        h = hash_password("secret123")
        db.create_user(username="bob", password_hash=h, role="TRADER")
        res = login("bob", "WRONG")
        assert res.ok is False
        assert res.api_key is None

    def test_login_unknown_user(self, isolated_db):
        res = login("nobody", "x")
        assert res.ok is False


# --------------------------------------------------------------------------- #
# ensure_default_admin
# --------------------------------------------------------------------------- #

def test_ensure_default_admin_creates_admin(isolated_db, monkeypatch):
    """When ADMIN_PASSWORD env is set, the default admin user should be
    created with that password on first call."""
    monkeypatch.setenv("ADMIN_PASSWORD", "test_admin_pw")
    user = db.ensure_default_admin()
    assert user["username"] == "admin"
    assert user["role"] == "ADMIN"
    # Should be idempotent
    user2 = db.ensure_default_admin()
    assert user2["id"] == user["id"]


# --------------------------------------------------------------------------- #
# require_role
# --------------------------------------------------------------------------- #

class TestRequireRole:
    @pytest.mark.asyncio
    async def test_auth_disabled_allows_any_role(self):
        """When auth_disabled is True, role check should pass."""
        dep = require_role("ADMIN")
        ctx = {"auth_disabled": True, "user": None}
        # The dependency is an async callable
        result = await dep(ctx)  # type: ignore[arg-type]
        assert result is ctx

    @pytest.mark.asyncio
    async def test_role_check_enforced(self):
        """A VIEWER user requesting an ADMIN endpoint should be rejected."""
        from fastapi import HTTPException
        dep = require_role("ADMIN")
        ctx = {"auth_disabled": False, "user": {"role": "VIEWER"}}
        with pytest.raises(HTTPException) as exc_info:
            await dep(ctx)  # type: ignore[arg-type]
        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_role_admin_passes(self):
        dep = require_role("ADMIN")
        ctx = {"auth_disabled": False, "user": {"role": "ADMIN"}}
        result = await dep(ctx)  # type: ignore[arg-type]
        assert result is ctx
