"""
Basic integration tests for the coffee shop app.
Run with: pytest tests/
"""
import json
import pytest

from app import create_app, db


@pytest.fixture
def client(tmp_path):
    app = create_app()
    app.config.update(
        TESTING=True,
        SQLALCHEMY_DATABASE_URI=f"sqlite:///{tmp_path}/test.db",
        WTF_CSRF_ENABLED=False,
    )
    with app.app_context():
        db.drop_all()
        db.create_all()
        from app.seed import seed_if_empty
        seed_if_empty()
    with app.test_client() as client:
        yield client


def login(client, role, username, password):
    return client.post("/login", data={"role": role, "username": username, "password": password}, follow_redirects=True)


def test_manager_login_success(client):
    r = login(client, "manager", "Manager#1", "password123")
    assert r.status_code == 200
    assert b"Sales Dashboard" in r.data or b"Today" in r.data


def test_manager_login_wrong_password(client):
    r = login(client, "manager", "Manager#1", "wrong")
    assert b"Invalid username or password" in r.data


def test_staff_login_success(client):
    r = login(client, "staff", "staff1", "staffpass123")
    assert r.status_code == 200


def test_staff_cannot_access_manager_pages(client):
    login(client, "staff", "staff1", "staffpass123")
    r = client.get("/manager/dashboard")
    assert r.status_code == 403


def test_menu_api_returns_categories(client):
    login(client, "staff", "staff1", "staffpass123")
    r = client.get("/staff/api/menu")
    data = r.get_json()
    assert "locations" in data
    assert len(data["hot_drinks"]) > 0
    assert len(data["fillings"]) > 0


def test_create_drink_order_with_options(client):
    login(client, "staff", "staff1", "staffpass123")
    menu = client.get("/staff/api/menu").get_json()
    americano = next(d for d in menu["hot_drinks"] if d["name"] == "Americano")
    own_cup = next(o for o in menu["drink_options"] if o["name"] == "Own Cup")

    payload = {
        "location_id": menu["locations"][0]["id"],
        "table_number": 1,
        "allergy_status": False,
        "allergens": [],
        "payment_method": "Card",
        "payment_confirmed": True,
        "items": [{"type": "drink", "menu_item_id": americano["id"], "option_ids": [own_cup["id"]], "quantity": 1}],
    }
    r = client.post("/staff/api/orders", data=json.dumps(payload), content_type="application/json")
    data = r.get_json()
    assert r.status_code == 200
    assert data["total"] == americano["price"] + own_cup["price"]  # 2.60 - 0.25 = 2.35


def test_table_number_validation(client):
    login(client, "staff", "staff1", "staffpass123")
    menu = client.get("/staff/api/menu").get_json()
    payload = {
        "location_id": menu["locations"][0]["id"],
        "table_number": 99,
        "payment_method": "Card",
        "payment_confirmed": True,
        "items": [{"type": "drink", "menu_item_id": menu["hot_drinks"][0]["id"], "option_ids": [], "quantity": 1}],
    }
    r = client.post("/staff/api/orders", data=json.dumps(payload), content_type="application/json")
    assert r.status_code == 400


def test_cash_payment_change_calculation(client):
    login(client, "staff", "staff1", "staffpass123")
    menu = client.get("/staff/api/menu").get_json()
    americano = next(d for d in menu["hot_drinks"] if d["name"] == "Americano")
    payload = {
        "location_id": menu["locations"][0]["id"],
        "table_number": 2,
        "payment_method": "Cash",
        "amount_received": 5.00,
        "items": [{"type": "drink", "menu_item_id": americano["id"], "option_ids": [], "quantity": 1}],
    }
    r = client.post("/staff/api/orders", data=json.dumps(payload), content_type="application/json")
    assert r.status_code == 200


def test_cash_insufficient_amount_rejected(client):
    login(client, "staff", "staff1", "staffpass123")
    menu = client.get("/staff/api/menu").get_json()
    americano = next(d for d in menu["hot_drinks"] if d["name"] == "Americano")
    payload = {
        "location_id": menu["locations"][0]["id"],
        "table_number": 3,
        "payment_method": "Cash",
        "amount_received": 0.50,
        "items": [{"type": "drink", "menu_item_id": americano["id"], "option_ids": [], "quantity": 1}],
    }
    r = client.post("/staff/api/orders", data=json.dumps(payload), content_type="application/json")
    assert r.status_code == 400


def test_sandwich_price_calculation(client):
    login(client, "staff", "staff1", "staffpass123")
    menu = client.get("/staff/api/menu").get_json()
    filling = next(f for f in menu["fillings"] if f["name"] == "Tuna")
    bread = next(b for b in menu["bread"] if b["name"] == "White Baguette")
    extra = next(e for e in menu["extras"] if e["name"] == "Cheese")
    payload = {
        "location_id": menu["locations"][0]["id"],
        "table_number": 4,
        "payment_method": "Card",
        "payment_confirmed": True,
        "items": [{"type": "sandwich", "filling_id": filling["id"], "bread_id": bread["id"], "extra_ids": [extra["id"]], "quantity": 1}],
    }
    r = client.post("/staff/api/orders", data=json.dumps(payload), content_type="application/json")
    data = r.get_json()
    assert round(data["total"], 2) == round(filling["price"] + bread["price"] + extra["price"], 2)


def test_order_status_update(client):
    login(client, "staff", "staff1", "staffpass123")
    menu = client.get("/staff/api/menu").get_json()
    payload = {
        "location_id": menu["locations"][0]["id"],
        "table_number": 6,
        "payment_method": "Card",
        "payment_confirmed": True,
        "items": [{"type": "drink", "menu_item_id": menu["hot_drinks"][0]["id"], "option_ids": [], "quantity": 1}],
    }
    r = client.post("/staff/api/orders", data=json.dumps(payload), content_type="application/json")
    order_id = r.get_json()["order_id"]
    r2 = client.post(f"/staff/orders/{order_id}/status", data={"status": "Delivered"})
    assert r2.get_json()["status"] == "Delivered"


def test_manager_can_search_members(client):
    login(client, "manager", "Manager#1", "password123")
    r = client.get("/manager/members?q=1001")
    assert r.status_code == 200
    assert b"1001" in r.data


def test_manager_menu_management(client):
    login(client, "manager", "Manager#1", "password123")
    r = client.get("/manager/menu")
    assert r.status_code == 200


def test_manager_location_management(client):
    login(client, "manager", "Manager#1", "password123")
    r = client.post("/manager/locations/add", data={"name": "Rooftop"}, follow_redirects=True)
    assert r.status_code == 200
    assert b"Rooftop" in r.data


# ----------------
# Members created
# ---------------

import math


def _create_member(client, first="Ana", surname="Petrosyan", phone="+374 91 123456"):
    return client.post(
        "/staff/api/members",
        data=json.dumps({"first_name": first, "surname": surname, "phone": phone}),
        content_type="application/json",
    )


def _drink_order(client, menu, member_id=None, payment_method="Card", **extra):
    americano = next(d for d in menu["hot_drinks"] if d["name"] == "Americano")
    payload = {
        "location_id": menu["locations"][0]["id"],
        "table_number": 9,
        "member_id": member_id,
        "payment_method": payment_method,
        "payment_confirmed": True,
        "items": [{"type": "drink", "menu_item_id": americano["id"], "option_ids": [], "quantity": 3}],
    }
    payload.update(extra)
    return client.post("/staff/api/orders", data=json.dumps(payload), content_type="application/json")


def test_staff_can_create_member_with_auto_number(client):
    login(client, "staff", "staff1", "staffpass123")
    r = _create_member(client)
    assert r.status_code == 201
    member = r.get_json()["member"]
    assert member["member_number"] == "#1002"  # seed member is #1001
    assert member["name"] == "Ana Petrosyan"
    assert member["phone"] == "+37491123456"
    assert member["points"] == 0

    # Searchable by phone straight away
    results = client.get("/staff/api/members/search?q=91123456").get_json()["results"]
    assert any(m["id"] == member["id"] for m in results)


def test_create_member_validation(client):
    login(client, "staff", "staff1", "staffpass123")
    assert _create_member(client, first="").status_code == 400
    assert _create_member(client, phone="12").status_code == 400
    assert _create_member(client).status_code == 201
    dup = _create_member(client, first="Other", phone="+37491123456")
    assert dup.status_code == 409
    assert dup.get_json()["existing"]["member_number"] == "#1002"


def test_member_earns_points_on_card_order(client):
    login(client, "staff", "staff1", "staffpass123")
    menu = client.get("/staff/api/menu").get_json()
    member = _create_member(client).get_json()["member"]
    data = _drink_order(client, menu, member_id=member["id"]).get_json()
    assert data["points_earned"] == math.floor(data["total"])
    assert data["member_points"] == data["points_earned"]


def test_pay_with_member_points(client):
    login(client, "staff", "staff1", "staffpass123")
    menu = client.get("/staff/api/menu").get_json()
    member = client.get("/staff/api/members/search?q=1001").get_json()["results"][0]
    member_id, before = member["id"], member["points"]
    americano = next(d for d in menu["hot_drinks"] if d["name"] == "Americano")
    needed = math.ceil(round(americano["price"] * 100) / 10)  # 1 point = £0.10

    payload = {
        "location_id": menu["locations"][0]["id"],
        "table_number": 10,
        "member_id": member_id,
        "payment_method": "Member Points",
        "items": [{"type": "drink", "menu_item_id": americano["id"], "option_ids": [], "quantity": 1}],
    }
    r = client.post("/staff/api/orders", data=json.dumps(payload), content_type="application/json")
    assert r.status_code == 200, r.get_json()
    data = r.get_json()
    assert data["points_redeemed"] == needed
    assert data["points_earned"] == 0
    assert data["member_points"] == before - needed


def test_member_points_rejected_when_balance_too_low(client):
    login(client, "staff", "staff1", "staffpass123")
    menu = client.get("/staff/api/menu").get_json()
    member = _create_member(client).get_json()["member"]  # 0 points
    r = _drink_order(client, menu, member_id=member["id"], payment_method="Member Points")
    assert r.status_code == 400
    assert "Not enough points" in r.get_json()["error"]


def test_member_points_requires_member(client):
    login(client, "staff", "staff1", "staffpass123")
    menu = client.get("/staff/api/menu").get_json()
    r = _drink_order(client, menu, payment_method="Member Points")
    assert r.status_code == 400


def test_cancelling_order_reverses_points(client):
    login(client, "staff", "staff1", "staffpass123")
    menu = client.get("/staff/api/menu").get_json()
    member = _create_member(client).get_json()["member"]
    data = _drink_order(client, menu, member_id=member["id"]).get_json()
    assert data["member_points"] > 0

    client.post(f"/staff/orders/{data['order_id']}/status", data={"status": "Cancelled"})
    after = client.get("/staff/api/members/search?q=" + member["member_number"].lstrip("#")).get_json()["results"][0]
    assert after["points"] == 0


# -------------------
# Manager portal
# -------------------

def test_manager_sees_orders_taken_by_staff(client):
    login(client, "staff", "staff1", "staffpass123")
    menu = client.get("/staff/api/menu").get_json()
    order = _drink_order(client, menu).get_json()
    client.get("/logout")

    login(client, "manager", "Manager#1", "password123")
    r = client.get("/manager/orders")  # defaults to the Current tab
    assert order["order_number"].encode() in r.data
    assert b"Alex Staff" in r.data

    dash = client.get("/manager/dashboard")
    assert order["order_number"].encode() in dash.data


def test_manager_can_create_staff_who_can_then_log_in(client):
    login(client, "manager", "Manager#1", "password123")
    r = client.post("/manager/staff/create", data={
        "name": "Mariam Staff", "username": "mariam", "password": "secret123",
        "confirm_password": "secret123", "role": "staff",
    }, follow_redirects=True)
    assert b"Mariam Staff" in r.data
    client.get("/logout")

    r = login(client, "staff", "mariam", "secret123")
    assert b"My Orders" in r.data


def test_manager_creates_member_without_login(client):
    login(client, "manager", "Manager#1", "password123")
    r = client.post("/manager/members/create", data={
        "first_name": "Aram", "surname": "Sargsyan", "phone": "+374 99 000111",
    }, follow_redirects=True)
    assert b"Aram Sargsyan" in r.data
    assert b"#1002" in r.data
