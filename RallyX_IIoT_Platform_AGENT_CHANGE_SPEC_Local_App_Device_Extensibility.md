# RallyX IIoT Platform — Agent Change Spec (Local App / Device Extensibility)

> **Trạng thái:** BẮT BUỘC ÁP DỤNG CHO RALLYX V1
>
> **Thay thế:** File này **supersede** bản Change Spec có nội dung SaaS trước đó. Agent phải bỏ qua các yêu cầu về `Tenant`, multi-tenant isolation, Edge Registry, cloud sync, fleet management và SaaS trong giai đoạn hiện tại.
>
> **Mục tiêu V1:** Xây RallyX như một **ứng dụng IIoT local/on-prem bình thường**, cài trên một máy Linux/IPC, có thể tự do thêm Connection → Device → Tag và sử dụng Live Data / History / Alarm mà không sửa source code nếu protocol đã được hỗ trợ.
>
> **Quy tắc tracking:** Chỉ tick `- [x]` khi code đã hoàn thành, test đã pass và acceptance criteria tương ứng đã được verify.

---

# 1. Phạm vi hiện tại

RallyX V1 phải tập trung vào **một instance local/on-prem** phục vụ một hệ thống/nhà máy tại một thời điểm.

## Trong phạm vi V1

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

- [ ] Không hard-code `Pump01`, `Motor01`, `VFD01` hoặc bất kỳ thiết bị cụ thể nào trong RallyX Core.
- [ ] Seed data chỉ dùng để demo và phải đi qua cùng data model/API như dữ liệu thật.
- [ ] Web UI không phụ thuộc danh sách thiết bị cố định trong source code.
- [ ] Dashboard render từ metadata/config của Asset/Device/Tag.
- [ ] Alarm engine không biết thiết bị là motor, pump hay sensor.
- [ ] Runtime engine không biết thiết bị là motor, pump hay fan.

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

- [ ] Có entity `Site`.
- [ ] Có entity `Area`.
- [ ] Có entity `Asset`.
- [ ] Có entity `Device`.
- [ ] Có entity `Tag`.
- [ ] Không có `Tenant` trong V1.
- [ ] Không có `EdgeNode` / `EdgeRegistry` trong V1.
- [ ] Mọi telemetry phải truy vết được về Device + Tag + Asset.

---

## A3. API-first

- [ ] Web App chỉ giao tiếp với RallyX Core qua REST API / WebSocket.
- [ ] Web App không đọc database trực tiếp.
- [ ] Node-RED không ghi trực tiếp vào database business của RallyX.
- [ ] Node-RED chỉ đóng vai trò connectivity/adapter khi cần.
- [ ] Core là nơi xử lý metadata, runtime, event, alarm, history routing và API.
- [ ] MQTT là data bus/connectivity mechanism, không phải business database.

---

# 3. Connection model

Connection đại diện cho một kênh kết nối vật lý hoặc network.

## Protocol V1 bắt buộc

- [ ] Simulator
- [ ] MQTT
- [ ] Modbus TCP
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

- [ ] CRUD Connection API.
- [ ] UI `Settings > Connections`.
- [ ] Nút `Test Connection`.
- [ ] Validate protocol config trước Save.
- [ ] Thêm/sửa Connection không yêu cầu restart toàn platform.
- [ ] Một Connection lỗi không được làm crash Core hoặc worker khác.
- [ ] Có trạng thái `CONNECTED`, `DISCONNECTED`, `ERROR`, `DISABLED`.
- [ ] Hiển thị `last_seen` / `last_successful_poll`.

## B2. Modbus TCP config

- [ ] Host/IP.
- [ ] Port, default `502`.
- [ ] Unit/Slave ID khi cần.
- [ ] Timeout.
- [ ] Polling interval.
- [ ] Retry policy.

## B3. Modbus RTU config

- [ ] Serial device `/dev/ttyUSBx` hoặc mapping tương đương.
- [ ] Baudrate.
- [ ] Databits.
- [ ] Parity.
- [ ] Stopbits.
- [ ] Slave ID.
- [ ] Timeout.
- [ ] Polling interval.

## B4. MQTT config

- [ ] Broker URL/IP.
- [ ] Port.
- [ ] TLS enable/disable.
- [ ] Username/password hoặc secret reference.
- [ ] Topic subscription.
- [ ] Reconnect policy.
- [ ] Payload mapping.

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

- [ ] CRUD Device API.
- [ ] UI Add/Edit/Delete Device.
- [ ] Device chọn Connection có sẵn.
- [ ] Device có thể chọn Device Template hoặc khai báo thủ công.
- [ ] Disable Device phải dừng polling nhưng không xóa history.
- [ ] Xóa Device phải có confirmation và policy rõ với history cũ.

## Core acceptance criterion

> **Adding a new device using an already-supported protocol must not require recompiling or modifying RallyX source code.**

- [ ] Viết integration test cho acceptance criterion trên.

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

- [ ] bool
- [ ] int16
- [ ] uint16
- [ ] int32
- [ ] uint32
- [ ] float32
- [ ] float64 khi connector hỗ trợ
- [ ] string cho MQTT mapping khi cần

## Tag functionality

- [ ] CRUD Tag API.
- [ ] Tag Editor UI.
- [ ] Validate duplicate `key` trong cùng Device.
- [ ] Scale.
- [ ] Offset.
- [ ] Unit.
- [ ] History enable/disable.
- [ ] Realtime enable/disable.
- [ ] Deadband / change-of-value.
- [ ] Poll interval override.
- [ ] Byte order / word order cho Modbus.
- [ ] Quality state: `GOOD`, `BAD`, `UNCERTAIN`, `STALE`.

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

- [ ] Topic builder nằm trong shared package.
- [ ] Không hard-code topic ở nhiều module.
- [ ] MQTT topic phải map được về `device_id`.

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

- [ ] Core validate payload schema.
- [ ] Malformed payload không được làm crash ingestion pipeline.
- [ ] Preserve source timestamp nếu hợp lệ.
- [ ] Có server receive timestamp để debug latency/clock drift.
- [ ] Unknown tag phải có handling rõ: reject, log hoặc auto-map theo config; không được tạo ngầm không kiểm soát.

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

- [ ] CRUD Device Template API.
- [ ] Device Template UI.
- [ ] Tạo Device từ Template.
- [ ] Clone Tag definitions thành Tag instance.
- [ ] Cho phép override connection/slave ID/address.
- [ ] Update Template không được phá Tag instance đang chạy.
- [ ] Có version cho Template.

**Acceptance criterion**

- [ ] Tạo 10 thiết bị cùng model từ một Template chỉ cần nhập tên + slave/device address riêng.

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

- [ ] Import CSV preview trước commit.
- [ ] Validate từng row.
- [ ] Báo lỗi theo row/column.
- [ ] Không partial commit khi validation fail trong V1.
- [ ] Export Device/Tag config ra CSV.
- [ ] Import 100+ tags không yêu cầu click từng tag.

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

- [ ] Không tạo page component riêng cho mỗi model thiết bị.
- [ ] Tag `realtime_enabled=true` tự xuất hiện trong Live Data.
- [ ] Tag `store_history=true` có History/Trend.
- [ ] Alarm Rule được tạo từ Tag mà không sửa code.

## F2. Dashboard pinning

- [ ] User có thể `Pin to Dashboard` từ một Tag.
- [ ] Widget tối thiểu: Value.
- [ ] Widget tối thiểu: Status.
- [ ] Widget tối thiểu: Trend.
- [ ] Dashboard config lưu DB.
- [ ] Restart app không mất dashboard config.

---

# 10. Runtime / Event / Alarm Engine phải config-driven

## G1. Runtime rule

```text
Runtime source tag = device.run
RUN condition = true
```

- [ ] Runtime counter generic theo Tag config.
- [ ] Start Count dựa trên `false -> true`.
- [ ] Persist runtime qua restart.
- [ ] Không double-count telemetry duplicate.
- [ ] Cho phép reset counter có audit/log local.

## G2. Alarm rule

Tối thiểu hỗ trợ:

- [ ] Digital ON/OFF condition.
- [ ] High threshold.
- [ ] Low threshold.
- [ ] Delay/debounce.
- [ ] Severity.
- [ ] Acknowledge.
- [ ] Clear event.
- [ ] Alarm history.

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
- [ ] Template selector.
- [ ] Tag editor.
- [ ] Test Read từng Tag.
- [ ] Hiển thị raw value + decoded value trong Test Read.
- [ ] Connection status rõ ràng.
- [ ] Last successful poll.
- [ ] Không yêu cầu sửa YAML thủ công cho thao tác phổ biến.

---

# 12. Protocol scope

## V1 bắt buộc

- [ ] Simulator.
- [ ] MQTT.
- [ ] Modbus TCP.
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

- [ ] PostgreSQL/TimescaleDB lưu metadata + telemetry/history theo plan chính.
- [ ] History query theo Tag + time range.
- [ ] Có retention config local.
- [ ] Có downsampling/aggregation ở mức cần thiết nếu dữ liệu lớn.
- [ ] Không tối ưu cho hyperscale/SaaS ở V1.
- [ ] Có backup database local.
- [ ] Có restore test.

---

# 14. Security phạm vi local/on-prem

Không cần multi-tenant, nhưng app vẫn cần security cơ bản.

- [ ] Login local.
- [ ] Password hash an toàn.
- [ ] Tối thiểu role `Admin` và `Viewer` nếu plan chính đã có user management.
- [ ] Secrets không commit plaintext vào Git.
- [ ] MQTT credentials không hard-code.
- [ ] Audit/log thay đổi Connection/Device/Tag/Alarm Rule.
- [ ] Validate input API.
- [ ] Không expose DB port ra LAN mặc định nếu không cần.

---

# 15. Fault tolerance local

- [ ] Một Device mất kết nối không ảnh hưởng Device khác.
- [ ] Một Connection lỗi không crash toàn Core.
- [ ] Tag lỗi chuyển `BAD` hoặc `STALE`.
- [ ] Reconnect tự động.
- [ ] PostgreSQL/MQTT tạm unavailable phải có retry hợp lý.
- [ ] App restart phải recover cấu hình.
- [ ] Không mất runtime counter đã persist.

---

# 16. Cập nhật Implementation Plan chính

Agent phải mở `RallyX_IIoT_Platform_AGENT_IMPLEMENTATION_PLAN.md` và sửa các milestone sau.

## L1. Architecture milestone

- [ ] Xóa yêu cầu Tenant.
- [ ] Xóa multi-tenant isolation.
- [ ] Xóa Edge Registry.
- [ ] Xóa Cloud sync/SaaS requirement.
- [ ] Giữ `Site → Area → Asset → Device → Tag`.
- [ ] Bổ sung device extensibility principle.
- [ ] Bổ sung connector interface.
- [ ] Bổ sung normalized local telemetry contract.

## L2. Database milestone

- [ ] Migration Site.
- [ ] Migration Area.
- [ ] Migration Asset.
- [ ] Migration Connection.
- [ ] Migration Device.
- [ ] Migration Tag.
- [ ] Migration DeviceTemplate.
- [ ] Migration AlarmRule.
- [ ] Migration DashboardConfig.
- [ ] Time-series/hypertable cho telemetry.
- [ ] Không tạo Tenant/EdgeNode tables ở V1.

## L3. Backend/Core milestone

- [ ] CRUD Connections.
- [ ] CRUD Devices.
- [ ] CRUD Tags.
- [ ] CRUD Templates.
- [ ] Generic Runtime Engine.
- [ ] Generic Alarm Engine.
- [ ] Live Data API/WebSocket.
- [ ] History API.

## L4. Connectivity milestone

- [ ] Simulator connector.
- [ ] MQTT connector.
- [ ] Modbus TCP connector.
- [ ] Modbus RTU connector.
- [ ] Dynamic config reload.
- [ ] Test Connection.
- [ ] Test Read.

## L5. Web milestone

- [ ] Connections screen.
- [ ] Devices screen.
- [ ] Tags screen.
- [ ] Templates screen.
- [ ] Asset dynamic page.
- [ ] Live Data dynamic table.
- [ ] History dynamic trend.
- [ ] Alarm screen.
- [ ] Pin to Dashboard.

## L6. Import/export milestone

- [ ] CSV preview.
- [ ] CSV validation.
- [ ] CSV commit.
- [ ] CSV export.

## L7. Local deployment milestone

- [ ] Docker/Podman Compose.
- [ ] Offline image bundle.
- [ ] `install.sh`.
- [ ] `update.sh`.
- [ ] `backup.sh`.
- [ ] `restore.sh`.
- [ ] Auto-start after reboot.
- [ ] Health check.

---

# 17. Acceptance test end-to-end bắt buộc

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
- [ ] Không còn Tenant trong V1.
- [ ] Không còn Edge Registry trong V1.
- [ ] Không còn Cloud Sync/SaaS implementation trong V1.
- [ ] Có Site → Area → Asset → Device → Tag.
- [ ] Có CRUD Connection.
- [ ] Có CRUD Device.
- [ ] Có CRUD Tag.
- [ ] Có Modbus TCP dynamic configuration.
- [ ] Có Modbus RTU dynamic configuration.
- [ ] Có MQTT dynamic configuration.
- [ ] Có Simulator.
- [ ] Thêm Device bằng supported protocol không cần sửa source.
- [ ] Có Device Template.
- [ ] Có CSV import/export.
- [ ] Live Data tự nhận Tag mới.
- [ ] History tự nhận Tag `store_history=true`.
- [ ] Alarm generic theo Tag/Rule.
- [ ] Runtime generic theo Tag/Rule.
- [ ] Dashboard không hard-code Device.
- [ ] Test fault tolerance pass.
- [ ] Backup/restore local pass.
- [ ] Implementation Plan chính đã được cập nhật theo scope local.

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
- [ ] Agent đã cập nhật domain model local.
- [x] Agent đã cập nhật DB migrations plan.
- [ ] Agent đã cập nhật MQTT/local telemetry contract.
- [x] Agent đã cập nhật Connection/Device/Tag scope.
- [x] Agent đã cập nhật Device Template scope.
- [x] Agent đã cập nhật CSV import/export scope.
- [x] Agent đã cập nhật Web configuration flow.
- [ ] Agent đã thêm acceptance tests.
- [ ] Agent đã xác nhận Core/Web không hard-code use case.
- [ ] Agent bắt đầu implementation theo plan mới.

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
