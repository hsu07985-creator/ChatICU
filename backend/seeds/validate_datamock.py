"""Validate datamock JSON structure before json-mode seeding/startup."""

from __future__ import annotations

import sys
from typing import Any

from seeds.datamock_source import get_datamock_dir, load_json, unwrap_list


def _record_errors(
    records: list[dict[str, Any]],
    required_keys: tuple[str, ...],
    label: str,
    errors: list[str],
) -> None:
    for idx, record in enumerate(records):
        if not isinstance(record, dict):
            errors.append(f"{label}[{idx}] must be an object")
            continue
        for key in required_keys:
            value = record.get(key)
            if value is None:
                errors.append(f"{label}[{idx}] missing required key: {key}")
            elif isinstance(value, str) and value.strip() == "":
                errors.append(f"{label}[{idx}] key '{key}' cannot be empty")


def validate_datamock(*, raise_on_error: bool = False) -> dict[str, int]:
    errors: list[str] = []
    warnings: list[str] = []

    datamock_dir = get_datamock_dir()

    users_raw = load_json("users.json", required=True)
    patients_raw = load_json("patients.json", required=True)
    meds_raw = load_json("medications.json", required=True)
    lab_raw = load_json("labData.json", required=True)
    messages_raw = load_json("messages.json", required=True)
    interaction_raw = load_json("drugInteractions.json", required=True)

    users = unwrap_list(users_raw, "users")
    patients = unwrap_list(patients_raw, "patients")
    medications = unwrap_list(meds_raw, "medications")
    lab_data = unwrap_list(lab_raw, "labData")

    _record_errors(
        users,
        ("id", "name", "username", "role"),
        "users",
        errors,
    )
    _record_errors(
        patients,
        ("id", "name", "bedNumber", "medicalRecordNumber", "age", "gender", "diagnosis"),
        "patients",
        errors,
    )
    _record_errors(
        medications,
        ("id", "patientId", "name", "status"),
        "medications",
        errors,
    )
    _record_errors(
        lab_data,
        ("id", "patientId", "timestamp"),
        "labData",
        errors,
    )

    patient_messages: list[dict[str, Any]] = []
    team_messages: list[dict[str, Any]] = []
    if isinstance(messages_raw, dict):
        patient_messages = unwrap_list(messages_raw, "patientMessages")
        team_messages = unwrap_list(messages_raw, "teamChatMessages")
    elif isinstance(messages_raw, list):
        for msg in messages_raw:
            if not isinstance(msg, dict):
                errors.append("messages[] must be an object")
                continue
            msg_id = str(msg.get("id", ""))
            if msg_id.startswith("pmsg"):
                patient_messages.append(msg)
            elif msg_id.startswith("tchat"):
                team_messages.append(msg)
    else:
        errors.append("messages.json must be an object or array")

    if not patient_messages and not team_messages:
        warnings.append("messages.json contains no patient/team messages")

    _record_errors(
        patient_messages,
        ("id", "patientId", "authorId", "content", "timestamp"),
        "patientMessages",
        errors,
    )
    _record_errors(
        team_messages,
        ("id", "userId", "userRole", "content", "timestamp"),
        "teamChatMessages",
        errors,
    )

    interactions: list[dict[str, Any]] = []
    compatibilities: list[dict[str, Any]] = []
    if isinstance(interaction_raw, dict):
        interactions = (
            unwrap_list(interaction_raw, "drugInteractions")
            or unwrap_list(interaction_raw, "interactions")
        )
        compatibilities = (
            unwrap_list(interaction_raw, "ivCompatibility")
            or unwrap_list(interaction_raw, "compatibilities")
        )
    elif isinstance(interaction_raw, list):
        interactions = interaction_raw
    else:
        errors.append("drugInteractions.json must be an object or array")

    if not interactions and not compatibilities:
        warnings.append("drugInteractions.json contains no interactions/compatibilities")

    _record_errors(
        interactions,
        ("id", "drug1", "drug2", "severity"),
        "drugInteractions",
        errors,
    )
    _record_errors(
        compatibilities,
        ("id", "drug1", "drug2", "compatible"),
        "ivCompatibility",
        errors,
    )

    user_ids = {str(u.get("id")) for u in users if isinstance(u, dict) and u.get("id")}
    patient_ids = {str(p.get("id")) for p in patients if isinstance(p, dict) and p.get("id")}

    for idx, med in enumerate(medications):
        pid = med.get("patientId")
        if pid and str(pid) not in patient_ids:
            errors.append(f"medications[{idx}] references unknown patientId '{pid}'")

    for idx, item in enumerate(lab_data):
        pid = item.get("patientId")
        if pid and str(pid) not in patient_ids:
            errors.append(f"labData[{idx}] references unknown patientId '{pid}'")

    for idx, msg in enumerate(patient_messages):
        pid = msg.get("patientId")
        uid = msg.get("authorId")
        if pid and str(pid) not in patient_ids:
            errors.append(f"patientMessages[{idx}] references unknown patientId '{pid}'")
        if uid and str(uid) not in user_ids:
            errors.append(f"patientMessages[{idx}] references unknown authorId '{uid}'")

    for idx, msg in enumerate(team_messages):
        uid = msg.get("userId")
        if uid and str(uid) not in user_ids:
            errors.append(f"teamChatMessages[{idx}] references unknown userId '{uid}'")

    report = {
        "users": len(users),
        "patients": len(patients),
        "medications": len(medications),
        "labData": len(lab_data),
        "patientMessages": len(patient_messages),
        "teamChatMessages": len(team_messages),
        "drugInteractions": len(interactions),
        "ivCompatibility": len(compatibilities),
    }

    if errors:
        message = (
            f"Datamock validation failed at {datamock_dir} with {len(errors)} error(s):\n"
            + "\n".join(f"- {err}" for err in errors)
        )
        if raise_on_error:
            raise ValueError(message)
        print(message)
    else:
        print(f"Datamock validation passed: {report}")

    if warnings:
        print("Validation warnings:")
        for warning in warnings:
            print(f"- {warning}")

    return report


def main() -> None:
    try:
        validate_datamock(raise_on_error=True)
    except Exception as exc:
        print(f"[INTG][DB] datamock validation failed: {exc}")
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()

