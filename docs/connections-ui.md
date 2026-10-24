# Connections UI

The Connections page uses the local `/connections` API. Administrators can create, edit, enable/disable and archive links, and run Test Connection on saved, enabled configurations. Operators and viewers can inspect status and timestamps. API authorization remains authoritative.

Select a Site, protocol, polling interval and timeout. Protocol fields cover Simulator, MQTT broker URL/subscription, Modbus TCP host/port, and Modbus RTU serial framing. Use `mqtts://` for a TLS broker. Device-specific unit addresses, tag mapping and simulator values belong to the device/tag workflows. Existing protocol configuration and retry settings survive edits.

MQTT credentials are write-only. Both blank fields retain existing credentials; entering either field replaces the credential pair. Saved credentials are never populated into the form. Archiving requires explicit confirmation, retains history, and is rejected by Core while active devices reference the link.

Test Connection checks the saved configuration through Core and the connectivity service. Save edits before testing. Connection success is separate from a successful device poll; inspect both Last seen and Last successful poll. Refresh connections retrieves current server status.

## Verification and rollout

Component tests cover create/edit payloads, preserving write-only credentials, diagnostics and validation errors, viewer restrictions, and archive confirmation/history retention. Run `npm --prefix apps/web test -- --run` and `npm run lint` / `npm run build` from the repository root.

This source change does not upgrade the running baseline stack. The amended Core, device-aware UI and normalized producer must be rolled out together as described in `local-extensibility-plan.md`. Browser acceptance against that coordinated stack is still pending. Devices, Templates, complete Tag editor, CSV and dashboard pinning remain subsequent UI tasks. Physical RTU verification is a separate gate.

## Local development access

On the current Windows/WSL workstation, the verified baseline URL is `http://172.27.165.200:8080`. WSL addresses can change after a restart; obtain the current address with `wsl hostname -I`. Windows localhost forwarding was unavailable during verification. Keep a WSL session running while viewing the UI; Docker services run inside that environment. Credentials are installation-specific and kept in ignored `.env`, never in this document.
