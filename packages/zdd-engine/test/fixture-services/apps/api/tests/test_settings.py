import os
def test_x():
    assert os.environ.get("TWILIO_API_KEY") is None
