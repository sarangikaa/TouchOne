import json
from decimal import Decimal

from flask import Blueprint, render_template, jsonify, request, abort
from flask_login import login_required, current_user

from app import db
from app.models import (
    Location, MenuItem, DrinkOption, Order, OrderItem, Member,
    ALLERGEN_OPTIONS, ORDER_STATUSES, PAYMENT_METHODS, POINTS_PER_POUND, POINT_VALUE,
)
from app.utils import (
    role_required, next_order_number, next_member_number, normalise_phone,
    points_earned_for, points_needed_for,
)

staff_bp = Blueprint("staff", __name__, url_prefix="/staff")

ONGOING_STATUSES = ["Pending", "Preparing", "Confirmed"]


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------

@staff_bp.route("/dashboard")
@login_required
@role_required("staff", "manager")
def dashboard():
    tab = request.args.get("tab", "ongoing")

    query = Order.query.filter_by(staff_id=current_user.id)
    if tab == "delivered":
        orders = query.filter_by(order_status="Delivered").order_by(Order.updated_at.desc()).all()
    elif tab == "cancelled":
        orders = query.filter_by(order_status="Cancelled").order_by(Order.updated_at.desc()).all()
    else:
        tab = "ongoing"
        orders = query.filter(Order.order_status.in_(ONGOING_STATUSES)).order_by(Order.created_at.desc()).all()

    return render_template("staff/dashboard.html", orders=orders, tab=tab)


@staff_bp.route("/orders/new")
@login_required
@role_required("staff", "manager")
def new_order():
    return render_template(
        "staff/new_order.html",
        points_per_pound=POINTS_PER_POUND,
        point_value=float(POINT_VALUE),
    )


@staff_bp.route("/orders/<int:order_id>")
@login_required
@role_required("staff", "manager")
def order_detail(order_id):
    order = Order.query.get_or_404(order_id)
    return render_template("staff/order_detail.html", order=order)


@staff_bp.route("/orders/<int:order_id>/receipt")
@login_required
@role_required("staff", "manager")
def order_receipt(order_id):
    order = Order.query.get_or_404(order_id)
    return render_template("staff/receipt.html", order=order)


@staff_bp.route("/orders/<int:order_id>/status", methods=["POST"])
@login_required
@role_required("staff", "manager")
def update_status(order_id):
    order = Order.query.get_or_404(order_id)
    status = request.form.get("status")
    if status not in ORDER_STATUSES:
        abort(400)
    previous = order.order_status
    if order.member and previous != status:
        if status == "Cancelled":
            # Give back points spent on this order and take back points earned
            _apply_order_points(order, reverse=True)
        elif previous == "Cancelled":
            _apply_order_points(order, reverse=False)
    order.order_status = status
    if status == "Cancelled":
        order.payment_status = "Cancelled"
    db.session.commit()
    return jsonify({"ok": True, "status": order.order_status})


# ---------------------------------------------------------------------------
# JSON API used by the order wizard (order.js)
# ---------------------------------------------------------------------------

def _decimal_to_float(value):
    return float(value) if isinstance(value, Decimal) else value


def _apply_order_points(order, reverse):
    """Apply (or undo, when reverse=True) an order's points against its member."""
    sign = -1 if reverse else 1
    member = order.member
    member.points = max(0, member.points + sign * ((order.points_earned or 0) - (order.points_redeemed or 0)))


def _member_json(m):
    return {
        "id": m.id,
        "member_number": m.member_number,
        "name": m.name,
        "phone": m.phone or "",
        "points": m.points or 0,
    }


@staff_bp.route("/api/menu")
@login_required
@role_required("staff", "manager")
def api_menu():
    locations = [
        {"id": l.id, "name": l.name}
        for l in Location.query.filter_by(active=True).order_by(Location.name).all()
    ]

    def items_for(category):
        rows = MenuItem.query.filter_by(category=category, active=True).order_by(MenuItem.name).all()
        return [{"id": i.id, "name": i.name, "price": _decimal_to_float(i.price)} for i in rows]

    drink_options = [
        {"id": o.id, "name": o.name, "price": _decimal_to_float(o.price_adjustment)}
        for o in DrinkOption.query.filter_by(active=True).order_by(DrinkOption.id).all()
    ]

    return jsonify({
        "locations": locations,
        "hot_drinks": items_for("Hot Drinks"),
        "drinks": items_for("Drinks"),
        "fillings": items_for("Fillings"),
        "bread": items_for("Bread"),
        "extras": items_for("Sandwich Extras"),
        "drink_options": drink_options,
        "allergens": ALLERGEN_OPTIONS,
    })


@staff_bp.route("/api/members/search")
@login_required
@role_required("staff", "manager")
def api_members_search():
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify({"results": []})
    filters = [Member.member_number.ilike(f"%{q}%"), Member.name.ilike(f"%{q}%")]
    phone_q = normalise_phone(q).lstrip("+")
    if len(phone_q) >= 3:
        filters.append(Member.phone.ilike(f"%{phone_q}%"))
    rows = Member.query.filter(
        Member.active == True,  # noqa: E712
        db.or_(*filters),
    ).limit(10).all()
    return jsonify({"results": [_member_json(m) for m in rows]})


@staff_bp.route("/api/members", methods=["POST"])
@login_required
@role_required("staff", "manager")
def api_create_member():
    """Quick member sign-up from the order screen: name, surname and phone."""
    data = request.get_json(force=True, silent=True) or {}
    first_name = (data.get("first_name") or "").strip()
    surname = (data.get("surname") or "").strip()
    phone = normalise_phone(data.get("phone"))

    if not first_name or not surname:
        return jsonify({"error": "Please enter the member's name and surname."}), 400
    if len(phone.lstrip("+")) < 6:
        return jsonify({"error": "Please enter a valid phone number."}), 400

    existing = Member.query.filter_by(phone=phone).first()
    if existing:
        return jsonify({
            "error": f"This phone number already belongs to member {existing.member_number} ({existing.name}).",
            "existing": _member_json(existing),
        }), 409

    member = Member(
        member_number=next_member_number(),
        name=f"{first_name} {surname}",
        phone=phone,
        points=0,
        active=True,
    )
    db.session.add(member)
    db.session.commit()
    return jsonify({"ok": True, "member": _member_json(member)}), 201


@staff_bp.route("/api/orders", methods=["POST"])
@login_required
@role_required("staff", "manager")
def api_create_order():
    data = request.get_json(force=True, silent=True) or {}

    location = Location.query.get(data.get("location_id"))
    if not location or not location.active:
        return jsonify({"error": "Please choose a valid location."}), 400

    try:
        table_number = int(data.get("table_number"))
    except (TypeError, ValueError):
        return jsonify({"error": "Please choose a table number."}), 400
    if table_number < 1 or table_number > 50:
        return jsonify({"error": "Table number must be between 1 and 50."}), 400

    raw_items = data.get("items") or []
    if not raw_items:
        return jsonify({"error": "Add at least one item before placing the order."}), 400

    allergy_status = bool(data.get("allergy_status"))
    allergens = data.get("allergens") or []
    allergens = [a for a in allergens if a in ALLERGEN_OPTIONS]
    if not allergy_status:
        allergens = []

    member = None
    if data.get("member_id"):
        member = Member.query.get(data.get("member_id"))
        if not member or not member.active:
            return jsonify({"error": "That member account is not active."}), 400

    payment_method = data.get("payment_method")
    if payment_method not in PAYMENT_METHODS:
        return jsonify({"error": "Please choose a payment method."}), 400
    if payment_method == "Member Points" and not member:
        return jsonify({"error": "Select a member to pay with points."}), 400

    order_items = []
    total = Decimal("0.00")

    for raw in raw_items:
        item_type = raw.get("type")
        quantity = max(1, int(raw.get("quantity", 1)))

        if item_type == "drink":
            menu_item = MenuItem.query.get(raw.get("menu_item_id"))
            if not menu_item or not menu_item.active or menu_item.category not in ("Hot Drinks", "Drinks"):
                return jsonify({"error": "One of the drinks selected is no longer available."}), 400

            option_ids = raw.get("option_ids") or []
            options = DrinkOption.query.filter(DrinkOption.id.in_(option_ids), DrinkOption.active == True).all()  # noqa: E712
            option_payload = [{"name": o.name, "price": _decimal_to_float(o.price_adjustment)} for o in options]

            unit_price = menu_item.price + sum((o.price_adjustment for o in options), Decimal("0.00"))
            line_total = unit_price * quantity

            order_items.append(OrderItem(
                menu_item_id=menu_item.id,
                item_name=menu_item.name,
                item_type="drink",
                base_price=menu_item.price,
                quantity=quantity,
                total_price=line_total,
                options=json.dumps(option_payload),
            ))
            total += line_total

        elif item_type == "sandwich":
            filling = MenuItem.query.get(raw.get("filling_id"))
            bread = MenuItem.query.get(raw.get("bread_id"))
            if not filling or not bread or filling.category != "Fillings" or bread.category != "Bread":
                return jsonify({"error": "Please choose a filling and bread for the sandwich."}), 400

            extra_ids = raw.get("extra_ids") or []
            extras = MenuItem.query.filter(
                MenuItem.id.in_(extra_ids), MenuItem.category == "Sandwich Extras", MenuItem.active == True  # noqa: E712
            ).all()

            option_payload = [{"name": bread.name, "price": _decimal_to_float(bread.price)}]
            option_payload += [{"name": e.name, "price": _decimal_to_float(e.price)} for e in extras]

            unit_price = filling.price + bread.price + sum((e.price for e in extras), Decimal("0.00"))
            line_total = unit_price * quantity

            order_items.append(OrderItem(
                menu_item_id=filling.id,
                item_name=f"{filling.name} Sandwich",
                item_type="sandwich",
                base_price=filling.price,
                quantity=quantity,
                total_price=line_total,
                options=json.dumps(option_payload),
            ))
            total += line_total
        else:
            return jsonify({"error": "Unrecognised item type."}), 400

    amount_received = None
    change_due = None
    payment_status = "Pending"
    points_earned = 0
    points_redeemed = 0

    if payment_method == "Member Points":
        points_redeemed = points_needed_for(total)
        if member.points < points_redeemed:
            return jsonify({
                "error": f"Not enough points: this order needs {points_redeemed} points "
                         f"and the member has {member.points}."
            }), 400
        payment_status = "Paid (Points)"
    elif payment_method == "Cash":
        try:
            amount_received = Decimal(str(data.get("amount_received", "0")))
        except Exception:
            return jsonify({"error": "Enter a valid cash amount."}), 400
        if amount_received < total:
            return jsonify({"error": "Amount received is less than the order total."}), 400
        change_due = amount_received - total
        payment_status = "Paid"
    else:
        # Card — demo mode uses a clearly labelled simulated payment
        if not data.get("payment_confirmed"):
            return jsonify({"error": "Please confirm the card payment before placing the order."}), 400
        payment_status = "Paid (Simulated)"

    # Members earn points on every order they pay for with money (not with points)
    if member and payment_method != "Member Points":
        points_earned = points_earned_for(total)

    order = Order(
        order_number=next_order_number(),
        staff_id=current_user.id,
        member_id=member.id if member else None,
        location_id=location.id,
        table_number=table_number,
        allergy_status=allergy_status,
        allergens_text=",".join(allergens),
        payment_method=payment_method,
        payment_status=payment_status,
        order_status="Pending",
        total=total,
        amount_received=amount_received,
        change_due=change_due,
        points_earned=points_earned,
        points_redeemed=points_redeemed,
    )
    order.items = order_items
    if member:
        member.points = (member.points or 0) + points_earned - points_redeemed
    db.session.add(order)
    db.session.commit()

    return jsonify({
        "ok": True,
        "order_id": order.id,
        "order_number": order.order_number,
        "total": _decimal_to_float(total),
        "points_earned": points_earned,
        "points_redeemed": points_redeemed,
        "member_points": member.points if member else None,
    })
