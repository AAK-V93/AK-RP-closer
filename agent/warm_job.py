"""A page-load warm job only wakes the worker. It is not a practice call."""


def is_warm_job(room_name: str | None, metadata: dict | None) -> bool:
    if isinstance(metadata, dict) and metadata.get("warm") is True:
        return True
    return str(room_name or "").startswith("warm-")
