from typing import Any, Optional


def success_response(
    data: Any = None,
    message: Optional[str] = None,
) -> dict:
    response = {"success": True}
    if data is not None:
        response["data"] = data
    if message:
        response["message"] = message
    return response


def error_response(
    error: str,
    message: str,
    status_code: int = 400,
) -> dict:
    return {
        "success": False,
        "error": error,
        "message": message,
    }
