from functools import wraps

from flask import abort
from flask_login import current_user

from app.models import User


def role_required(*roles):
    """Restrict a route to logged-in Users (not Members) with one of the given roles.
    Enforced server-side — never rely on the frontend to hide manager-only pages.
    """
    def decorator(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            if not current_user.is_authenticated or not isinstance(current_user, User):
                abort(403)
            if current_user.role not in roles:
                abort(403)
            if not current_user.active:
                abort(403)
            return fn(*args, **kwargs)
        return wrapped
    return decorator


def next_order_number():
    """Generate the next sequential order number, e.g. #10007."""
    from app import db
    from app.models import Order
    count = db.session.query(Order).count()
    return f"#{10001 + count}"


def next_member_number():
    """Generate the next member number, e.g. #1004 (one higher than the largest existing)."""
    import re
    from app.models import Member
    highest = 1000
    for (number,) in Member.query.with_entities(Member.member_number).all():
        digits = re.sub(r"\D", "", number or "")
        if digits:
            highest = max(highest, int(digits))
    return f"#{highest + 1}"


def normalise_phone(raw):
    """Keep digits and a leading '+', so '+44 7700 900-123' and '+447700900123' match."""
    raw = (raw or "").strip()
    digits = "".join(ch for ch in raw if ch.isdigit())
    return ("+" + digits) if raw.startswith("+") else digits


def points_earned_for(total):
    """Points a member earns for an order total (whole pounds only)."""
    from decimal import Decimal, ROUND_FLOOR
    from app.models import POINTS_PER_POUND
    return int((Decimal(total) * POINTS_PER_POUND).to_integral_value(rounding=ROUND_FLOOR))


def points_needed_for(total):
    """Points required to pay an order total in full (rounded up)."""
    from decimal import Decimal, ROUND_CEILING
    from app.models import POINT_VALUE
    return int((Decimal(total) / POINT_VALUE).to_integral_value(rounding=ROUND_CEILING))
