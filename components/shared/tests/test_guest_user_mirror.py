# components/shared/tests/test_guest_user_mirror.py
from aimusic_shared.models import User
def test_user_mirror_carries_the_guest_columns():
    cols = User.__table__.c
    assert cols["is_guest"].nullable is False
    assert cols["guest_expires_at"].nullable is True
    assert cols["guest_device_id"].type.length == 26
