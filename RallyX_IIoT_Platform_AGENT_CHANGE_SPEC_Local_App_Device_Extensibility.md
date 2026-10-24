# RallyX IIoT Platform — Agent Change Spec (Local App / Device Extensibility)

> **Trạng thái:** BẮT BUỘC ÁP DỤNG CHO RALLYX V1
>
> **Thay thế:** File này **supersede** bản Change Spec có nội dung SaaS trước đó. Agent phải bỏ qua các yêu cầu về `Tenant`, multi-tenant isolation, Edge Registry, cloud sync, fleet management và SaaS trong giai đoạn hiện tại.
>
> **Mục tiêu V1:** Xây RallyX như một **ứng dụng IIoT local/on-prem bình thường**, cài trên một máy Linux/IPC, có thể tự do thêm Connection → Device → Tag và sử dụng Live Data / History / Alarm mà không sửa source code nếu protocol đã được hỗ trợ.
>
> **Quy tắc tracking:** Chỉ tick `- [x]` khi code đã hoàn thành, test đã pass và acceptance criteria tương ứng đã được verify.

> **Đồng bộ tiến độ 2026-10-23 — mã nguồn `3896305`:** Các mục backend/API, model, migration, template, CSV và connectivity đã được tích trực tiếp bên dưới theo bằng chứng tại [bảng đối chiếu](docs/checklist-evidence.md). `[x]` chỉ xác nhận đúng phạm vi của mục đó; không đồng nghĩa tính năng đã có Web UI hoặc đã nâng cấp bản đang chạy. Các mục UI, acceptance theo kịch bản, RTU phần cứng và deployment vẫn mở. Mục chưa tích có thể đã có một phần code nhưng chưa đủ bằng chứng hoàn thành.

| Nhóm | Tiến độ đã xác minh | Còn lại |
|---|---|---|
| Model / Core API / telemetry | Entity local, CRUD, validation, history, lifecycle giữ dữ liệu | Nghiệm thu đồng bộ với UI/producer mới |
| Template / CSV / dashboard | Template clone 10 devices; CSV 120 tags atomic; widget lưu theo user | UI template/CSV/pinning; restart toàn stack |
| Connectivity | Simulator, MQTT, Modbus TCP, reload, Test Connection/Test Read; Docker acceptance 23/23 | RTU phần cứng; workflow bằng UI |
| Runtime / Alarm | Transition, session, chống trùng, high/hysteresis, stale, ack/clear | Digital OFF, debounce, reset counter; coverage mở rộng |
| Vận hành / release | Compose và health check | Offline, reboot, backup/restore, update/rollback, bundle đa kiến trúc |

---

# 1. Phạm vi hiện tại

RallyX V1 phải tập trung vào **một instance local/on-prem** phục vụ một hệ thống/nhà máy tại một thời điểm.

## Trong phạm vi V1

Danh sách sản phẩm tổng thể này giữ theo acceptance tích hợp; tiến độ backend/API được tích ở các mục chi tiết và các tiêu chí tương ứng trong §18. Chưa tích toàn bộ tính năng ở đây chỉ từ bằng chứng API riêng lẻ.

- [ ] Chạy local trên Linux.
- [ ] Có Web App truy cập bằng trình duyệt.
- [ ] Có cấu hình động cho Connection / Device / Tag.
- [ ] Hỗ trợ Simulator, MQTT, Modbus TCP, Modbus RTU.
- [ ] Có Live Data.
- [ ] Có History / Trend.
- [ ] Có Alarm / Event.
- [ ] Có Runtime / Start Count dạng generic.
- [ ] Có Device Template.
- [ ] Có CSV import/export.
- [ ] Có dashboard động, không hard-code thiết bị.
- [ ] Có backup/restore cấu hình và dữ liệu local.

## Ngoài phạm vi V1

Các mục dưới đây **không được build ở thời điểm hiện tại**:

- [ ] ~~Tenant / multi-tenant~~ — **OUT OF SCOPE**
- [ ] ~~Tenant isolation~~ — **OUT OF SCOPE**
- [ ] ~~RallyX Cloud~~ — **OUT OF SCOPE**
- [ ] ~~Cloud sync~~ — **OUT OF SCOPE**
- [ ] ~~Edge Registry~~ — **OUT OF SCOPE**
- [ ] ~~Fleet management~~ — **OUT OF SCOPE**
- [ ] ~~Subscription / billing~~ — **OUT OF SCOPE**
- [ ] ~~SaaS provisioning~~ — **OUT OF SCOPE**
- [ ] ~~Multi-site central cloud~~ — **OUT OF SCOPE**

> **Nguyên tắc:** Không pre-build SaaS ở V1. Chỉ giữ code sạch, module hóa và API-first để sau này có thể nâng cấp nếu cần.

---

# 2. Nguyên tắc kiến trúc bắt buộc

## A1. Không hard-code thiết bị/use case

- [x] Không hard-code `Pump01`, `Motor01`, `VFD01` hoặc bất kỳ thiết bị cụ thể nào trong RallyX Core.
- [x] Seed data chỉ dùng để demo và phải đi qua cùng data model/API như dữ liệu thật.
- [x] Web UI không phụ thuộc danh sách thiết bị cố định trong source code.
- [ ] Dashboard render từ metadata/config của Asset/Device/Tag.
- [x] Alarm engine không biết thiết bị là motor, pump hay sensor.
- [x] Runtime engine không biết thiết bị là motor, pump hay fan.

**Acceptance criterion**

- [ ] Xóa toàn bộ demo seed data.
- [ ] Tạo một thiết bị mới từ UI.
- [ ] Tạo tag mới.
- [ ] Live Data hiển thị.
- [ ] History lưu được.
- [ ] Alarm tạo và trigger được.
- [ ] Không sửa source code.

---

## A2. Local hierarchy đơn giản

Data model V1 dùng cấu trúc:

```text
Site
  └── Area
       └── Asset
            └── Device
                 └── Tag
```

Trong đó:

- `Site`: nhà máy / hệ thống đang cài RallyX. V1 có thể chỉ có một Site mặc định.
- `Area`: khu vực / line / phân xưởng / hệ thống.
- `Asset`: đối tượng cần giám sát, ví dụ MCC-01, Conveyor-01, Compressor-01.
- `Device`: PLC, VFD, power meter, remote I/O, sensor gateway...
- `Tag`: data point đọc được từ Device hoặc tính toán từ dữ liệu.

- [x] Có entity `Site`.
- [x] Có entity `Area`.
- [x] Có entity `Asset`.
- [x] Có entity `Device`.
- [x] Có entity `Tag`.
- [x] Không có `Tenant` trong V1.
- [x] Không có `EdgeNode` / `EdgeRegistry` trong V1.
- [x] Mọi telemetry phải truy vết được về Device + Tag + Asset.

---

## A3. API-first

- [x] Web App chỉ giao tiếp với RallyX Core qua REST API / WebSocket.
- [x] Web App không đọc database trực tiếp.
- [x] Node-RED không ghi trực tiếp vào database business của RallyX.
- [x] Node-RED chỉ đóng vai trò connectivity/adapter khi cần.
- [x] Core là nơi xử lý metadata, runtime, event, alarm, history routing và API.
- [x] MQTT là data bus/connectivity mechanism, không phải business database.

---

# 3. Connection model

Connection đại diện cho một kênh kết nối vật lý hoặc network.

## Protocol V1 bắt buộc

- [x] Simulator
- [x] MQTT
- [x] Modbus TCP
- [ ] Modbus RTU

## Schema logic tối thiểu

```text
Connection
- id
- name
- protocol
- enabled
- polling_interval_ms
- timeout_ms
- retry_policy
- protocol_config JSON
- status
- last_seen
- created_at
- updated_at
```

## B1. Connection CRUD

- [x] CRUD Connection API.
- [x] UI `Settings > Connections`.
- [x] Nút `Test Connection`.
- [x] Validate protocol config trước Save.
- [x] Thêm/sửa Connection không yêu cầu restart toàn platform.
- [x] Một Connection lỗi không được làm crash Core hoặc worker khác.
- [x] Có trạng thái `CONNECTED`, `DISCONNECTED`, `ERROR`, `DISABLED`.
- [x] Hiển thị `last_seen` / `last_successful_poll`.

## B2. Modbus TCP config

- [x] Host/IP.
- [x] Port, default `502`.
- [x] Unit/Slave ID khi cần.
- [x] Timeout.
- [x] Polling interval.
- [x] Retry policy.

## B3. Modbus RTU config

Adapter và trường cấu hình đã có trong code; queue/close/late-open đã có regression. Các mục serial/framing chưa tích vì chưa kiểm chứng transport RTU thật. Timeout và lịch polling được kiểm thử ở tầng worker chung.

- [ ] Serial device `/dev/ttyUSBx` hoặc mapping tương đương.
- [ ] Baudrate.
- [ ] Databits.
- [ ] Parity.
- [ ] Stopbits.
- [ ] Slave ID.
- [x] Timeout.
- [x] Polling interval.

## B4. MQTT config

- [x] Broker URL/IP.
- [x] Port.
- [ ] TLS enable/disable.
- [x] Username/password hoặc secret reference.
- [x] Topic subscription.
- [ ] Reconnect policy.
- [x] Payload mapping.

---

# 4. Device model

```text
Device
- id
- area_id optional
- asset_id
- connection_id
- template_id optional
- name
- manufacturer
- model
- serial_number optional
- protocol_device_address / slave_id optional
- enabled
- metadata JSON
- created_at
- updated_at
```

- [x] CRUD Device API.
- [x] UI Add/Edit/Delete Device.
- [x] Device chọn Connection có sẵn.
- [x] Device có thể chọn Device Template hoặc khai báo thủ công.
- [x] Disable Device phải dừng polling nhưng không xóa history.
- [x] Xóa Device phải có confirmation và policy rõ với history cũ.

## Core acceptance criterion

> **Adding a new device using an already-supported protocol must not require recompiling or modifying RallyX source code.**

- [x] Viết integration test cho acceptance criterion trên.

---

# 5. Tag model

```text
Tag
- id
- asset_id
- device_id
- name
- key
- source_type
- address / register
- function_code optional
- data_type
- byte_order optional
- word_order optional
- scale
- offset
- unit
- poll_interval override optional
- deadband optional
- store_history
- realtime_enabled
- quality
- enabled
- metadata JSON optional
```

## Data type tối thiểu

- [x] bool
- [x] int16
- [x] uint16
- [x] int32
- [x] uint32
- [x] float32
- [x] float64 khi connector hỗ trợ
- [ ] string cho MQTT mapping khi cần

## Tag functionality

Các cờ history/realtime và deadband đã có schema/code nhưng chưa được tích riêng khi chưa có đủ kiểm thử bật/tắt tương ứng. Tag Editor UI còn phải chuyển sang device model.

- [x] CRUD Tag API.
- [x] Tag Editor UI.
- [x] Validate duplicate `key` trong cùng Device.
- [x] Scale.
- [x] Offset.
- [x] Unit.
- [ ] History enable/disable.
- [ ] Realtime enable/disable.
- [ ] Deadband / change-of-value.
- [x] Poll interval override.
- [x] Byte order / word order cho Modbus.
- [x] Quality state: `GOOD`, `BAD`, `UNCERTAIN`, `STALE`.

---

# 6. Normalized telemetry contract

Tất cả connector phải chuyển dữ liệu về một model chuẩn trước khi Core xử lý.

## C1. MQTT topic local

Không cần namespace SaaS/tenant.

Dùng convention local đơn giản:

```text
rallyx/v1/device/{deviceId}/telemetry
rallyx/v1/device/{deviceId}/event
rallyx/v1/device/{deviceId}/status
```

Hoặc connector nội bộ có thể gọi Core trực tiếp qua interface chuẩn nếu không cần MQTT.

- [x] Topic builder nằm trong shared package.
- [ ] Không hard-code topic ở nhiều module.
- [x] MQTT topic phải map được về `device_id`.

## C2. Normalized telemetry payload

```json
{
  "timestamp": "2026-10-23T09:00:00.000Z",
  "device_id": "vfd-01",
  "asset_id": "conveyor-01",
  "values": {
    "run": true,
    "fault": false,
    "current": 7.42
  },
  "quality": "GOOD"
}
```

- [x] Core validate payload schema.
- [x] Malformed payload không được làm crash ingestion pipeline.
- [x] Preserve source timestamp nếu hợp lệ.
- [x] Có server receive timestamp để debug latency/clock drift.
- [x] Unknown tag phải có handling rõ: reject, log hoặc auto-map theo config; không được tạo ngầm không kiểm soát.

---

# 7. Device Template

## D1. Device Template model

```text
DeviceTemplate
- id
- name
- manufacturer
- model
- protocol
- version
- description
- tag_definitions[]
```

Ví dụ:

```text
Template: Delta MS300
Protocol: Modbus RTU
Tags:
- Run
- Fault
- Frequency
- Current
- Output Voltage
- DC Bus
- Alarm Code
```

- [x] CRUD Device Template API.
- [x] Device Template UI.
- [x] Tạo Device từ Template.
- [x] Clone Tag definitions thành Tag instance.
- [x] Cho phép override connection/slave ID/address.
- [x] Update Template không được phá Tag instance đang chạy.
- [x] Có version cho Template.

**Acceptance criterion**

- [x] Tạo 10 thiết bị cùng model từ một Template chỉ cần nhập tên + slave/device address riêng.

---

# 8. CSV Import / Export

CSV phục vụ cấu hình nhiều thiết bị/tag nhanh.

## Format tối thiểu

```csv
device,tag,address,data_type,unit,scale,store_history
VFD01,current,40010,float32,A,0.1,true
VFD01,frequency,40012,float32,Hz,0.01,true
VFD02,current,40010,float32,A,0.1,true
```

- [x] Import CSV preview trước commit.
- [x] Validate từng row.
- [x] Báo lỗi theo row/column.
- [x] Không partial commit khi validation fail trong V1.
- [x] Export Device/Tag config ra CSV.
- [x] Import 100+ tags không yêu cầu click từng tag.

---

# 9. Auto-generated UI / Dashboard

## F1. Asset/Device page động

Khi thêm Asset/Device/Tag, UI tự render:

```text
Asset Detail
- Device Status
- Current Values
- Last Update
- Tag List
- Runtime nếu được cấu hình
- Fault/Alarm nếu được cấu hình
- History/Trend link
```

- [x] Không tạo page component riêng cho mỗi model thiết bị.
- [x] Tag `realtime_enabled=true` tự xuất hiện trong Live Data.
- [x] Tag `store_history=true` có History/Trend.
- [x] Alarm Rule được tạo từ Tag mà không sửa code.

## F2. Dashboard pinning

Đã kiểm chứng lưu định nghĩa Value/Status/Trend bằng API theo từng user; chưa nghiệm thu render widget, thao tác Pin và restart toàn platform bằng UI.

- [x] User có thể `Pin to Dashboard` từ một Tag.
- [x] Widget tối thiểu: Value.
- [x] Widget tối thiểu: Status.
- [x] Widget tối thiểu: Trend.
- [x] Dashboard config lưu DB.
- [x] Restart app không mất dashboard config.

---

# 10. Runtime / Event / Alarm Engine phải config-driven

## G1. Runtime rule

Test đã tạo lại `Engine`/`Registry` để kiểm chứng trạng thái lấy từ SQL. Các mục restart toàn tiến trình/platform vẫn mở; không dùng test tạo lại object để tích acceptance restart toàn stack.

```text
Runtime source tag = device.run
RUN condition = true
```

- [x] Runtime counter generic theo Tag config.
- [x] Start Count dựa trên `false -> true`.
- [ ] Persist runtime qua restart.
- [x] Không double-count telemetry duplicate.
- [ ] Cho phép reset counter có audit/log local.

## G2. Alarm rule

Tối thiểu hỗ trợ:

- [ ] Digital ON/OFF condition.
- [x] High threshold.
- [ ] Low threshold.
- [ ] Delay/debounce.
- [x] Severity.
- [x] Acknowledge.
- [x] Clear event.
- [x] Alarm history.

Alarm Engine chỉ nhận `Tag ID + Rule Config`; không biết thiết bị là gì.

---

# 11. Plug & Play Configuration UI

Workflow mục tiêu:

```text
Settings
  → Connections
  → Add Connection
  → Test Connection
  → Add Device
  → Select Template hoặc Manual
  → Add/Edit Tags
  → Test Read
  → Save
  → Live Data
  → History
  → Alarm
```

- [ ] Connection wizard.
- [ ] Device wizard.
- [x] Template selector.
- [x] Tag editor.
- [x] Test Read từng Tag.
- [x] Hiển thị raw value + decoded value trong Test Read.
- [x] Connection status rõ ràng.
- [x] Last successful poll.
- [ ] Không yêu cầu sửa YAML thủ công cho thao tác phổ biến.

---

# 12. Protocol scope

## V1 bắt buộc

- [x] Simulator.
- [x] MQTT.
- [x] Modbus TCP.
- [ ] Modbus RTU.

## Future connector — KHÔNG BUILD V1

- [ ] OPC UA — future.
- [ ] Siemens S7 — future.
- [ ] EtherNet/IP — future.
- [ ] BACnet — future.
- [ ] SNMP — future.

Connector mới sau này phải implement cùng interface và trả về normalized telemetry model.

---

# 13. Local database / history

V1 dùng database local trong stack RallyX.

- [x] PostgreSQL/TimescaleDB lưu metadata + telemetry/history theo plan chính.
- [x] History query theo Tag + time range.
- [ ] Có retention config local.
- [ ] Có downsampling/aggregation ở mức cần thiết nếu dữ liệu lớn.
- [x] Không tối ưu cho hyperscale/SaaS ở V1.
- [ ] Có backup database local.
- [ ] Có restore test.

---

# 14. Security phạm vi local/on-prem

Không cần multi-tenant, nhưng app vẫn cần security cơ bản.

- [x] Login local.
- [x] Password hash an toàn.
- [x] Tối thiểu role `Admin` và `Viewer` nếu plan chính đã có user management.
- [x] Secrets không commit plaintext vào Git.
- [x] MQTT credentials không hard-code.
- [x] Audit/log thay đổi Connection/Device/Tag/Alarm Rule.
- [x] Validate input API.
- [x] Không expose DB port ra LAN mặc định nếu không cần.

---

# 15. Fault tolerance local

- [x] Một Device mất kết nối không ảnh hưởng Device khác.
- [x] Một Connection lỗi không crash toàn Core.
- [x] Tag lỗi chuyển `BAD` hoặc `STALE`.
- [x] Reconnect tự động.
- [ ] PostgreSQL/MQTT tạm unavailable phải có retry hợp lý.
- [ ] App restart phải recover cấu hình.
- [ ] Không mất runtime counter đã persist.

---

# 16. Cập nhật Implementation Plan chính

Agent phải mở `RallyX_IIoT_Platform_AGENT_IMPLEMENTATION_PLAN.md` và sửa các milestone sau.

## L1. Architecture milestone

- [x] Xóa yêu cầu Tenant.
- [x] Xóa multi-tenant isolation.
- [x] Xóa Edge Registry.
- [x] Xóa Cloud sync/SaaS requirement.
- [x] Giữ `Site → Area → Asset → Device → Tag`.
- [x] Bổ sung device extensibility principle.
- [x] Bổ sung connector interface.
- [x] Bổ sung normalized local telemetry contract.

## L2. Database milestone

- [x] Migration Site.
- [x] Migration Area.
- [x] Migration Asset.
- [x] Migration Connection.
- [x] Migration Device.
- [x] Migration Tag.
- [x] Migration DeviceTemplate.
- [x] Migration AlarmRule.
- [x] Migration DashboardConfig.
- [x] Time-series/hypertable cho telemetry.
- [x] Không tạo Tenant/EdgeNode tables ở V1.

## L3. Backend/Core milestone

- [x] CRUD Connections.
- [x] CRUD Devices.
- [x] CRUD Tags.
- [x] CRUD Templates.
- [ ] Generic Runtime Engine.
- [ ] Generic Alarm Engine.
- [x] Live Data API/WebSocket.
- [x] History API.

## L4. Connectivity milestone

- [x] Simulator connector.
- [x] MQTT connector.
- [x] Modbus TCP connector.
- [ ] Modbus RTU connector.
- [x] Dynamic config reload.
- [x] Test Connection.
- [x] Test Read.

Backend/API and Linux-container verification recorded in `docs/implementation-ledger.md`; RTU adapter code is implemented, but physical serial acceptance and UI workflow acceptance remain open.

## L5. Web milestone

- [x] Connections screen.
- [x] Devices screen.
- [x] Tags screen.
- [x] Templates screen.
- [x] Asset dynamic page.
- [x] Live Data dynamic table.
- [x] History dynamic trend.
- [x] Alarm screen.
- [x] Pin to Dashboard.

## L6. Import/export milestone

- [x] CSV preview.
- [x] CSV validation.
- [x] CSV commit.
- [x] CSV export.

## L7. Local deployment milestone

- [x] Docker/Podman Compose.
- [ ] Offline image bundle.
- [ ] `install.sh`.
- [ ] `update.sh`.
- [ ] `backup.sh`.
- [ ] `restore.sh`.
- [ ] Auto-start after reboot.
- [x] Health check.

---

# 17. Acceptance test end-to-end bắt buộc

Các kịch bản bên dưới giữ mở cho đến khi chạy đúng toàn bộ workflow được mô tả. Acceptance API/container đã pass được ghi riêng tại [bảng bằng chứng](docs/checklist-evidence.md); không thay thế các bước thao tác UI, hai thiết bị template sáu tags, CSV lên Live Data hoặc restart toàn stack.

## Test 1 — Add Device không sửa code

- [ ] Start RallyX clean.
- [ ] Tạo Modbus TCP Connection từ UI.
- [ ] Test Connection pass.
- [ ] Tạo Device mới.
- [ ] Tạo 5 Tags.
- [ ] Test Read pass.
- [ ] Save.
- [ ] Live Data hiển thị.
- [ ] History được lưu.
- [ ] Tạo Alarm Rule.
- [ ] Trigger Alarm thành công.
- [ ] Không rebuild/recompile source.
- [ ] Không restart toàn stack thủ công.

## Test 2 — Device Template

- [ ] Tạo Template 6 tags.
- [ ] Tạo Device A từ Template.
- [ ] Tạo Device B từ Template.
- [ ] Chỉ thay slave/device address.
- [ ] Hai Device poll độc lập.
- [ ] History tách đúng theo Device/Tag.

## Test 3 — Dynamic Dashboard

- [ ] Tạo Tag mới.
- [ ] Pin Tag lên Dashboard.
- [ ] Widget hiển thị không sửa frontend source.
- [ ] Restart platform.
- [ ] Dashboard config vẫn còn.

## Test 4 — Fault tolerance

- [ ] Ngắt một Modbus Device.
- [ ] Device còn lại vẫn chạy.
- [ ] Tag Device lỗi chuyển BAD/STALE.
- [ ] Core không crash.
- [ ] Device trở lại thì polling tự recover.

## Test 5 — CSV import

- [ ] Chuẩn bị CSV >= 100 Tags.
- [ ] Preview thành công.
- [ ] Validation phát hiện row lỗi.
- [ ] Sửa lỗi và import lại.
- [ ] Tags được tạo đúng.
- [ ] Live Data đọc được sau import.

## Test 6 — Restart / persistence

- [ ] Tạo Connection + Device + Tags + Dashboard widgets.
- [ ] Có Runtime > 0.
- [ ] Restart toàn RallyX stack.
- [ ] Config còn nguyên.
- [ ] Dashboard còn nguyên.
- [ ] Runtime persisted đúng.
- [ ] History query được dữ liệu cũ.

---

# 18. Definition of Done cho Change Spec này

Chỉ coi Change Spec hoàn thành khi:

- [ ] RallyX chạy như một app local/on-prem độc lập.
- [x] Không còn Tenant trong V1.
- [x] Không còn Edge Registry trong V1.
- [x] Không còn Cloud Sync/SaaS implementation trong V1.
- [x] Có Site → Area → Asset → Device → Tag.
- [x] Có CRUD Connection.
- [x] Có CRUD Device.
- [x] Có CRUD Tag.
- [x] Có Modbus TCP dynamic configuration.
- [ ] Có Modbus RTU dynamic configuration.
- [x] Có MQTT dynamic configuration.
- [x] Có Simulator.
- [ ] Thêm Device bằng supported protocol không cần sửa source.
- [x] Có Device Template.
- [x] Có CSV import/export.
- [x] Live Data tự nhận Tag mới.
- [x] History tự nhận Tag `store_history=true`.
- [ ] Alarm generic theo Tag/Rule.
- [ ] Runtime generic theo Tag/Rule.
- [ ] Dashboard không hard-code Device.
- [ ] Test fault tolerance pass.
- [ ] Backup/restore local pass.
- [x] Implementation Plan chính đã được cập nhật theo scope local.

---

# 19. Nguyên tắc cho Agent khi triển khai

1. **Ưu tiên app local chạy được trước.**
2. **Không build SaaS ở V1.**
3. Không thêm Tenant/Edge Registry/cloud abstraction chỉ vì “có thể cần sau này”.
4. Không hard-code Device để demo nhanh.
5. Device mới phải được thêm bằng config/UI nếu protocol đã support.
6. Connector mới phải theo interface chung.
7. Telemetry phải qua normalized data model.
8. UI không bypass API để đọc DB.
9. Không tick task nếu chưa test/verify.
10. Nếu Change Spec này mâu thuẫn với bản SaaS Change Spec cũ, **file này thắng**.
11. Sau mỗi milestone phải cập nhật Progress Log trong implementation plan chính.
12. YAGNI: không thêm feature chưa phục vụ V1 local.

---

# 20. Progress Checklist — Change Spec

- [x] Agent đã đọc implementation plan gốc.
- [x] Agent đã đọc Change Spec local này.
- [x] Agent đã đánh dấu Change Spec SaaS cũ là superseded/ignore.
- [x] Agent đã xóa Tenant khỏi V1 plan.
- [x] Agent đã xóa Edge Registry khỏi V1 plan.
- [x] Agent đã xóa Cloud/SaaS tasks khỏi V1 plan.
- [x] Agent đã cập nhật domain model local.
- [x] Agent đã cập nhật DB migrations plan.
- [x] Agent đã cập nhật MQTT/local telemetry contract.
- [x] Agent đã cập nhật Connection/Device/Tag scope.
- [x] Agent đã cập nhật Device Template scope.
- [x] Agent đã cập nhật CSV import/export scope.
- [x] Agent đã cập nhật Web configuration flow.
- [x] Agent đã thêm acceptance tests.
- [ ] Agent đã xác nhận Core/Web không hard-code use case.
- [x] Agent bắt đầu implementation theo plan mới.

## Progress Log

2026-10-24: Dynamic UI + device producer verified in separate preview: Chromium 9/9, zero-hardware API E2E, real DB/broker backend suite and full-stack restart persistence pass. Source-level UI items are checked; physical RTU, detailed Rule Engine, offline/recovery/release gates remain scoped separately. See `docs/ui-configuration.md` and `docs/implementation-ledger.md`.

2026-10-24: Connections UI source added with administrator create/edit/disable/archive, read-only non-admin access, protocol fields, status timestamps and Test Connection feedback. Component tests verify payloads, write-only credential retention, errors and archive confirmation. Full UI rollout/acceptance remains unchecked until the amended device/producer stack is coordinated; see `docs/connections-ui.md`.

| Ngày | Nhóm | Kết quả / bằng chứng |
|---|---|---|
| 2026-10-23 | Đồng bộ checkbox với implementation | Bổ sung 158 mục đã xác minh ngoài các mục có sẵn; đối chiếu code/test của `3896305`, kết quả backend DB/broker và connectivity Docker 23/23. UI, phần cứng RTU, restart/offline/restore và Definition of Done tổng thể vẫn mở. Xem `docs/checklist-evidence.md`. |

---

# Kết quả cuối mong muốn của RallyX V1

```text
PLC / VFD / Sensor / Remote I/O
             │
   Modbus TCP / RTU / MQTT
             │
             ▼
       RallyX Connectivity
             │
             ▼
          MQTT/Core
             │
             ▼
        RallyX Core
  Asset / Device / Tag
  Runtime / Event / Alarm
             │
             ▼
 PostgreSQL + TimescaleDB
             │
             ▼
         RallyX Web
 Live / History / Alarm
 Dashboard / Configuration
```

RallyX V1 phải là một **IIoT app local, cấu hình động, dễ cài, dễ thêm thiết bị và không bị hard-code theo một demo cụ thể**.

SaaS chỉ được xem xét ở một phase tương lai sau khi V1 local ổn định; không được làm tăng scope hoặc độ phức tạp của V1 hiện tại.
