#!/usr/bin/env python3
"""Validate carinyaparc deployment manifests against squad charters and targets."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def parse_charter_roster(charter_text: str) -> set[str]:
    roster: set[str] = set()
    in_roster = False
    for line in charter_text.splitlines():
        if re.match(r"^## Roster", line):
            in_roster = True
            continue
        if in_roster and line.startswith("## "):
            break
        match = re.search(r"`([a-z0-9-]+)`", line)
        if in_roster and match:
            slug = match.group(1)
            if slug not in {"squad", "type"}:
                roster.add(slug)
    return roster


def squad_label_from_charter(charter_path: Path) -> str | None:
    text = charter_path.read_text(encoding="utf-8")
    match = re.search(r"\*\*Label:\*\*\s*`([^`]+)`", text)
    return match.group(1) if match else None


def main() -> int:
    instance_root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
    errors: list[str] = []

    instance_path = instance_root / "config" / "instance.json"
    if not instance_path.exists():
        print(f"error: missing {instance_path}", file=sys.stderr)
        return 1

    instance = load_json(instance_path)
    squad_labels = instance.get("labels", {}).get("squad", {})
    targets_dir = instance_root / "config" / "targets"
    deployments_dir = instance_root / "config" / "deployments"

    known_targets = {
        p.stem: load_json(p) for p in targets_dir.glob("*.json")
    }
    charter_rosters: dict[str, set[str]] = {}
    charter_labels: dict[str, str] = {}

    for target_id, target in known_targets.items():
        for squad_key, charter_rel in target.get("squads", {}).items():
            charter_path = instance_root / charter_rel
            if not charter_path.exists():
                errors.append(f"missing charter: {charter_rel}")
                continue
            text = charter_path.read_text(encoding="utf-8")
            charter_rosters[squad_key] = parse_charter_roster(text)
            label = squad_label_from_charter(charter_path)
            if label:
                charter_labels[squad_key] = label

    for deploy_path in sorted(deployments_dir.glob("*.json")):
        deploy = load_json(deploy_path)
        deploy_id = deploy.get("id", deploy_path.stem)
        agent = deploy.get("agent")
        squad = deploy.get("squad")
        repos = deploy.get("repos", [])
        ritual = deploy.get("ritual")
        platform = deploy.get("platform")

        if not agent:
            errors.append(f"{deploy_id}: missing agent")
            continue

        if platform not in {
            "cursor",
            "claude-cma",
            "either",
            None,
        } and platform:
            errors.append(f"{deploy_id}: invalid platform '{platform}'")

        if squad and squad != "cross-squad":
            roster = charter_rosters.get(squad)
            if roster is None:
                errors.append(f"{deploy_id}: unknown squad '{squad}'")
            elif agent not in roster:
                errors.append(
                    f"{deploy_id}: agent '{agent}' not in squad '{squad}' charter roster"
                )

        for repo in repos:
            if repo not in known_targets and repo != "carinyaparc":
                errors.append(f"{deploy_id}: repo '{repo}' not in config/targets/")

        if ritual:
            ritual_path = instance_root / "config" / "cadence" / f"{ritual}.md"
            if not ritual_path.exists():
                errors.append(f"{deploy_id}: missing cadence/{ritual}.md")

        for secret in deploy.get("secrets", []):
            if not re.match(r"^[A-Z][A-Z0-9_]*$", secret):
                errors.append(f"{deploy_id}: invalid secret name '{secret}'")

    if errors:
        print("Deployment validation FAILED:", file=sys.stderr)
        for err in errors:
            print(f"  ✗ {err}", file=sys.stderr)
        return 1

    count = len(list(deployments_dir.glob("*.json")))
    print(f"PASSED — {count} deployment(s) validated against charters and targets")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
