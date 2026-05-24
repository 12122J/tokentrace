# Security

## Reporting A Vulnerability

Please report security issues privately through GitHub Security Advisories when
available. If advisories are not available, contact the repository owner
directly.

Do not open public issues for vulnerabilities involving secret exposure,
command execution, path traversal, or unsafe report rendering.

## Data Handling

Agent Flight Recorder writes local artifacts. Those artifacts may include:

- prompts and model output
- stdout and stderr
- git patches
- file paths
- token usage
- command strings

Review `.afr/runs/<run-id>/` before sharing it. Secret redaction is not yet
implemented.

## Supported Versions

This project is pre-1.0. Security fixes target the latest commit on `main`.
