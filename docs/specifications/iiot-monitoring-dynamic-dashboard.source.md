# IIoT Monitoring & Dynamic Dashboard Platform

## 1. Mục tiêu hệ thống

Xây dựng một nền tảng IIoT có khả năng giám sát từ một thiết bị đơn lẻ đến toàn bộ nhà máy mà không cần sửa code mỗi khi thêm máy, tủ điện, sensor hoặc ứng dụng mới.

Hệ thống không được thiết kế theo kiểu:

`Dashboard A → Machine A → Tag A`

mà phải theo mô hình:

`Entity → Profile → Data Points → Dashboard Template → Runtime Binding`

Ví dụ cùng một ứng dụng có thể triển khai cho:

- Tủ điện MDB/DB.
- Máy CNC.
- Compressor.
- Pump.
- Chiller.
- AHU.
- Motor/VFD.
- Solar inverter.
- Energy meter.
- Production line.
- Warehouse.
- Building.
- Một khu vực.
- Một nhà máy.
- Nhiều nhà máy của cùng khách hàng.

Khi tạo một entity mới, hệ thống chỉ cần:

**Create Entity → chọn Profile → map dữ liệu → chọn Dashboard Template**

Sau đó dashboard của entity đó tự xuất hiện.

Không cần developer viết lại frontend.

---

# 2. Kiến trúc Asset/Entity linh hoạt

Đây là thành phần quan trọng nhất của hệ thống.

Thay vì hard-code cấu trúc nhà máy, hệ thống sử dụng một cây hoặc graph entity.

Ví dụ:

```text
Customer
└── Factory HCM
    ├── Electrical System
    │   ├── MDB-01
    │   │   ├── Energy Meter
    │   │   ├── MCCB-01
    │   │   └── MCCB-02
    │   └── MDB-02
    │
    ├── Production Area A
    │   ├── Line A1
    │   │   ├── Machine 01
    │   │   │   ├── PLC
    │   │   │   ├── VFD
    │   │   │   └── Temperature Sensor
    │   │   └── Machine 02
    │   └── Line A2
    │
    └── Utility
        ├── Compressor 01
        ├── Compressor 02
        └── Chiller 01
```

Entity có thể là:

```text
Organization
Site
Factory
Building
Floor
Area
Production Line
Electrical Panel
Machine
Equipment
Device
Sensor
Gateway
Virtual Asset
```

Administrator phải có thể tạo thêm Entity Type mới mà không cần sửa source code.

Ví dụ:

```text
Entity Type = Cold Storage Room
Entity Type = EV Charger
Entity Type = Solar Plant
Entity Type = Water Tank
```

---

# 3. Entity Metadata

Mỗi entity có metadata riêng.

Ví dụ Machine:

```text
Name
Code
Type
Manufacturer
Model
Serial Number
Installation Date
Location
Parent Entity
Responsible Person
Rated Power
Rated Voltage
Description
Image
Tags
```

Một thiết bị:

```text
Device ID
Device Profile
Protocol
Gateway
Firmware
IP Address
MAC
Last Seen
Status
Location
```

Admin có thể tự tạo Custom Field.

Ví dụ:

```text
rated_current
motor_power
production_capacity
panel_voltage
maintenance_cycle
department
cost_center
```

---

# 4. Device Profile

Các thiết bị cùng loại không nên cấu hình lại từng thiết bị.

Ví dụ profile:

```text
Schneider PM5350
Acrel ADW210
Siemens S7
Mitsubishi FX5U
Delta VFD
ABB ACS580
Temperature Sensor
Air Compressor
Generic Modbus Meter
```

Device Profile định nghĩa:

```text
Telemetry schema
Attributes
Unit
Data type
Protocol mapping
Alarm rules
Calculated values
Dashboard template
Default icon
Default image
Default commands
```

Ví dụ:

```text
Profile: 3-Phase Energy Meter

Telemetry:

voltage_l1
voltage_l2
voltage_l3

current_l1
current_l2
current_l3

active_power
reactive_power
power_factor
frequency
energy_import
energy_export
```

Khi thêm meter mới:

```text
Add Device
→ Select "3-Phase Energy Meter"
→ Configure communication
→ Done
```

Dashboard, alarm và telemetry schema được kế thừa từ profile.

---

# 5. Tag / Data Point Management

Hệ thống cần một Data Point abstraction.

Một data point gồm:

```text
key
display_name
description
unit
data_type

source

aggregation
precision

min
max

warning range
critical range

historical storage
sampling rate
```

Ví dụ:

```text
Key:
voltage_l1

Display:
L1 Voltage

Unit:
V

Type:
FLOAT

Aggregation:
AVG

Precision:
1

Warning:
< 200 V
> 240 V

Critical:
< 180 V
> 250 V
```

Không để widget phụ thuộc trực tiếp vào Modbus address.

Ví dụ không nên:

```text
Widget → Holding Register 40123
```

Mà nên:

```text
Widget
↓
voltage_l1
↓
Device Mapping
↓
Modbus 40123
```

Nhờ vậy dashboard không quan tâm dữ liệu đến từ:

```text
Modbus
MQTT
OPC UA
BACnet
REST API
PLC
Gateway
```

---

# 6. Dashboard Engine

Dashboard phải được xem là một đối tượng có thể tạo, chỉnh sửa, clone, export và import.

Một dashboard gồm:

```text
Dashboard
 ├── Pages
 ├── Sections
 ├── Widgets
 ├── Variables
 ├── Entity Context
 ├── Time Range
 └── Permissions
```

Admin có thể:

```text
Create Dashboard
Edit Dashboard
Duplicate Dashboard
Delete Dashboard
Export Dashboard
Import Dashboard
Assign Dashboard
Create Dashboard Template
```

---

# 7. Dashboard Template

Đây là chức năng quyết định khả năng scale của platform.

Ví dụ tạo:

```text
Template:
3-Phase Power Meter
```

Widget sử dụng:

```text
${entity.voltage_l1}
${entity.voltage_l2}
${entity.voltage_l3}
${entity.active_power}
```

Không sử dụng:

```text
MDB01_meter01_voltage_l1
```

Nếu có:

```text
Meter A
Meter B
Meter C
```

cả ba dùng chung template.

Khi người dùng mở:

```text
/devices/meter-A
```

dashboard nhận:

```text
entity = Meter A
```

Khi mở:

```text
/devices/meter-B
```

dashboard đó nhận:

```text
entity = Meter B
```

Không cần tạo ba frontend khác nhau.

---

# 8. Dashboard tự động theo Device / Machine

Khi tạo entity mới:

```text
Machine CNC-06
```

và chọn:

```text
Profile:
CNC Machine
```

hệ thống tự gán:

```text
Dashboard Template:
CNC Machine Dashboard
```

Sau đó menu:

```text
Factory
 → Area A
   → CNC-06
```

click CNC-06 sẽ mở dashboard tương ứng.

---

# 9. Dashboard Overview

Dashboard Overview dùng để nhìn trạng thái toàn hệ thống trong vài giây.

Ví dụ đầu trang:

```text
TOTAL ASSETS        128

RUNNING             102
STOPPED              18
FAULT                 5
OFFLINE               3
```

Hiển thị tỷ lệ:

```text
79.7% Running
14.1% Stopped
3.9% Fault
2.3% Offline
```

---

# 10. Factory Status Overview

Có thể có Factory Health Score.

Ví dụ:

```text
Factory Status

Healthy         82%
Warning         12%
Critical         4%
Offline          2%
```

Các trạng thái phải configurable.

Không hard-code chỉ:

```text
ON/OFF
```

Profile có thể định nghĩa:

```text
RUNNING
IDLE
STOPPED
FAULT
MAINTENANCE
OFFLINE
UNKNOWN
```

---

# 11. Tổng quan điện năng

Overview có thể hiển thị:

```text
Total Active Power
Total Reactive Power
Total Energy Today
Total Energy This Month
Peak Demand
Average Power Factor
Grid Frequency
```

Ví dụ:

```text
Current Load
742 kW

Peak Today
891 kW

Energy Today
8,423 kWh

Average PF
0.94
```

Với Voltage và Current, aggregation phải cấu hình được.

Ví dụ:

```text
Voltage:
AVG / MIN / MAX per phase

Current:
SUM / AVG / MAX

Power:
SUM

Energy:
SUM
```

Không nên mặc định cộng điện áp của tất cả thiết bị vì trong nhiều hệ thống điện giá trị đó không có ý nghĩa vật lý.

Dashboard nên thể hiện:

```text
Average Voltage
Minimum Voltage
Maximum Voltage
Phase Imbalance

Total Current
Peak Current

Total Active Power
Total Energy
```

---

# 12. Energy Flow

Có thể có Sankey/flow diagram:

```text
GRID
 ↓
MDB
 ↓
--------------------------------
↓              ↓               ↓
Production     HVAC           Utility
420 kW         180 kW         95 kW
```

Nếu có solar/BESS:

```text
GRID ────────┐
             ↓
SOLAR ───→ FACTORY
             ↑
BESS ────────┘
```

Cho phép xem:

```text
Grid Consumption
Solar Generation
Battery Charge
Battery Discharge
Factory Load
Export Energy
```

---

# 13. Runtime / Downtime

Mỗi machine có state history.

Ví dụ:

```text
08:00 RUNNING
10:13 STOPPED
10:25 RUNNING
13:02 FAULT
13:15 RUNNING
```

Hệ thống tính:

```text
Runtime
Downtime
Idle Time
Fault Time
Offline Time
```

Theo:

```text
Today
Yesterday
Shift
Week
Month
Custom range
```

Overview:

```text
Runtime Today
72.4%

Downtime
18.7%

Idle
6.2%

Fault
2.7%
```

---

# 14. Machine Timeline

Một visualization rất hữu ích:

```text
00:00 ───────────────────────────── 24:00

████████ Running
▒▒▒▒▒▒▒▒ Idle
████ Stop
████ Fault
```

Người dùng có thể click một khoảng downtime để xem:

```text
Start
End
Duration
Reason
Alarm
Operator Note
```

---

# 15. Alarm System

Alarm không chỉ là danh sách message.

Alarm phải là một entity riêng.

Một alarm gồm:

```text
Alarm ID
Entity
Alarm Type
Severity
Status

Trigger Time
Acknowledge Time
Clear Time

Value
Threshold

Description

Acknowledged By
Resolved By

Comment
```

---

# 16. Alarm Severity

Có thể cấu hình:

```text
INFO
WARNING
MINOR
MAJOR
CRITICAL
```

hoặc profile riêng của từng khách hàng.

---

# 17. Alarm Lifecycle

Alarm có lifecycle:

```text
ACTIVE
↓
ACKNOWLEDGED
↓
CLEARED
```

hoặc:

```text
ACTIVE
↓
ACKNOWLEDGED
↓
IN PROGRESS
↓
RESOLVED
```

---

# 18. Alarm Rules

Admin có thể tạo rule:

```text
IF voltage_l1 > 250 V
FOR 10 seconds
THEN Critical Alarm
```

Hoặc:

```text
IF temperature > 80
AND machine_state = RUNNING
FOR 30 seconds
THEN High Temperature Alarm
```

Hoặc:

```text
IF last_seen > 5 minutes
THEN Device Offline
```

Có hỗ trợ:

```text
>
<
>=
<=
=
!=
AND
OR
duration
hysteresis
```

Hysteresis rất cần để alarm không ON/OFF liên tục quanh threshold.

---

# 19. Alarm History

Overview phải có:

```text
Alarm Trend

Today      28
Yesterday  17

Critical    3
Major       8
Warning    17
```

Biểu đồ:

```text
Alarm count/hour
Alarm count/day
Alarm count/device
Alarm count/type
Alarm duration
```

Có:

```text
Top 10 Alarm Devices
Top 10 Alarm Types
Longest Active Alarms
Repeated Alarms
```

---

# 20. Alarm Notification

Alarm có thể gửi qua:

```text
Web notification
Email
SMS
Telegram
Microsoft Teams
Slack
Webhook
Mobile Push
```

Routing configurable.

Ví dụ:

```text
Critical:
→ Supervisor
→ Maintenance

Warning:
→ Dashboard only
```

Có thể định nghĩa escalation:

```text
Critical alarm

0 minute
→ Operator

5 minutes not ACK
→ Supervisor

15 minutes
→ Manager
```

---

# 21. Real-time Monitoring

Dashboard cập nhật realtime thông qua:

```text
WebSocket
MQTT
SSE
```

không cần reload page.

Widget có thể hiển thị trạng thái connection:

```text
LIVE

Last update:
13:42:08
```

Nếu dữ liệu cũ:

```text
STALE DATA
Last received 7 minutes ago
```

---

# 22. Historical Trends

Trend Viewer là chức năng bắt buộc.

User có thể chọn:

```text
Device
Telemetry
Time Range
Aggregation
```

Ví dụ:

```text
MDB-01

Voltage L1
Voltage L2
Voltage L3
Current L1
Current L2
Current L3
Power
```

Time:

```text
Last 15 min
1 hour
6 hours
24 hours
7 days
30 days
Custom
```

Aggregation:

```text
Raw
Average
Min
Max
Sum
Delta
```

---

# 23. Compare Data

Cho phép compare:

```text
Machine A vs Machine B

Today vs Yesterday

This Week vs Last Week

Area A vs Area B
```

Ví dụ:

```text
Energy Consumption

Line A     182 kWh
Line B     231 kWh
Line C     174 kWh
```

---

# 24. Flexible Widget Library

Dashboard Builder nên cung cấp widget:

### KPI

```text
Value Card
Status Card
Progress
Gauge
LED
Battery
Signal Strength
```

### Chart

```text
Time Series
Line
Area
Bar
Stacked Bar
Pie
Donut
Histogram
Heatmap
Scatter
```

### Industrial

```text
Machine Status
Motor
Pump
Fan
VFD
Tank
Valve
Breaker
Energy Meter
Temperature
Pressure
Flow
```

### Data

```text
Table
Alarm Table
Event Table
Device Table
Ranking Table
```

### Navigation

```text
Asset Tree
Device List
Factory Map
Floor Plan
Tabs
Breadcrumb
```

### Advanced

```text
Sankey
State Timeline
Production Timeline
Heatmap
XY Plot
Custom SVG
Custom Widget
```

---

# 25. Dashboard Builder

Admin có GUI editor.

Có thể:

```text
Drag
Drop
Resize
Move
Clone
Delete
Copy
Paste
```

Widget properties:

```text
Title
Data Source
Entity
Metric
Unit
Precision
Aggregation
Time Range
Color
Threshold
Legend
Axis
Refresh Rate
```

---

# 26. Responsive Dashboard

Mỗi dashboard phải có layout:

```text
Desktop
Tablet
Mobile
Wall Display
```

Có thể configure riêng từng layout.

---

# 27. Drill-down Navigation

Ví dụ Overview:

```text
Factory
```

click:

```text
Area A
```

→ Area dashboard.

Click:

```text
Line 01
```

→ Line dashboard.

Click:

```text
Machine CNC-03
```

→ Machine dashboard.

Click:

```text
VFD
```

→ Device dashboard.

Breadcrumb:

```text
Factory HCM
/
Area A
/
Line 01
/
CNC-03
/
VFD-01
```

---

# 28. Dynamic Filtering

Dashboard Overview có filter:

```text
Factory
Area
Line
Equipment Type
Device Type
Status
Alarm Severity
Time
```

Ví dụ chọn:

```text
Factory: HCM
Area: Utility
Equipment: Compressor
```

toàn bộ dashboard tự cập nhật.

---

# 29. Search

Global Search:

```text
Search...

CNC-01
MDB-02
ADW210-123
Compressor
Alarm #1045
```

Có thể search theo:

```text
name
code
serial
tag
IP
device ID
location
```

---

# 30. Calculated Metrics

Platform cần Formula Engine.

Ví dụ:

```text
total_power =
power_l1 + power_l2 + power_l3
```

```text
voltage_imbalance =
(max_voltage - avg_voltage)
/ avg_voltage * 100
```

```text
runtime_ratio =
runtime /
scheduled_time * 100
```

```text
energy_cost =
energy_kwh * tariff
```

Admin tạo calculated field mà không sửa backend.

---

# 31. Aggregation Engine

Một asset có thể tổng hợp dữ liệu của toàn bộ children.

Ví dụ:

```text
Factory
 ├ Area A
 │ ├ Machine A
 │ └ Machine B
 └ Area B
```

Factory power:

```text
SUM(
 descendants.active_power
)
```

Area runtime:

```text
AVG(
 descendants.runtime_ratio
)
```

Có các aggregation:

```text
SUM
AVG
MIN
MAX
COUNT
LAST
FIRST
DELTA
```

---

# 32. Virtual Metrics

Không phải mọi metric đều đến từ sensor.

Có thể tạo Virtual Data Point.

Ví dụ:

```text
Factory Health
Energy Intensity
Machine Availability
Communication Health
Active Alarm Count
```

---

# 33. Communication Monitoring

IIoT dashboard phải biết thiết bị còn online hay không.

Mỗi device có:

```text
Connected
Disconnected
Last Seen
Data Freshness
Packet Count
Error Count
Signal
Gateway
```

Overview:

```text
Devices

Online     93
Offline     4
Stale       3
```

---

# 34. Gateway Monitoring

Gateway dashboard:

```text
CPU
RAM
Disk
Temperature
Network
Internet
Uptime

Connected Devices
MQTT Status
Cloud Status
```

Nếu gateway mất Internet nhưng vẫn chạy local:

```text
EDGE ONLINE
CLOUD DISCONNECTED
```

---

# 35. Edge / Offline Support

IIoT thực tế không thể giả định Internet luôn hoạt động.

Gateway cần:

```text
Store and Forward
Local Buffer
Reconnect
Data synchronization
```

Dashboard phải phân biệt:

```text
Device Offline

Gateway Offline

Cloud Connection Lost

Stale Telemetry
```

---

# 36. Protocol Layer

Platform nên hỗ trợ hoặc cho phép gateway chuyển đổi:

```text
MQTT
MQTT Sparkplug B

OPC UA

Modbus TCP
Modbus RTU

BACnet/IP

HTTP REST API

WebSocket

EtherNet/IP

PROFINET via Gateway

Serial

LoRaWAN
```

Frontend không phụ thuộc protocol.

---

# 37. Device Mapping

Ví dụ device Modbus:

```text
voltage_l1
→ Holding Register 100

current_l1
→ Holding Register 110
```

Device OPC UA:

```text
voltage_l1
→ ns=2;s=Meter.VoltageL1
```

Device MQTT:

```text
voltage_l1
→ factory/mdb01/telemetry
→ JSON $.voltage_l1
```

Tất cả đều đưa về canonical telemetry:

```text
voltage_l1
```

---

# 38. Device Provisioning

Device có thể thêm bằng:

```text
Manual

Bulk Import CSV

API

Auto Discovery

Gateway Discovery
```

Bulk:

```text
100 meters
```

có thể import một lần.

---

# 39. Dashboard auto-generation

Device Profile có:

```text
Default Dashboard Template
```

Ví dụ:

```text
Acrel ADW210
→ Energy Meter Template

ABB ACS580
→ VFD Template

S7-1200
→ PLC Template
```

Khi add device dashboard được tạo hoặc liên kết tự động.

---

# 40. Custom Dashboard theo từng ứng dụng

Platform cung cấp Dashboard Templates như:

```text
Electrical Monitoring

Machine Monitoring

Energy Management

Water Monitoring

HVAC Monitoring

Solar Monitoring

Compressed Air Monitoring

Production Monitoring

Environmental Monitoring
```

Nhưng user được tự tạo:

```text
Customer X – Boiler Room

Customer Y – MCC Monitoring

Customer Z – Cold Storage
```

Không cần thay đổi source code.

---

# 41. Electrical Monitoring Dashboard

Có thể bao gồm:

```text
Voltage L1/L2/L3
Current L1/L2/L3
Active Power
Reactive Power
Apparent Power
Power Factor
Frequency
Energy

Voltage imbalance
Current imbalance

THD
Demand
Peak Demand
```

Alarm:

```text
Over Voltage
Under Voltage
Over Current
Low PF
Phase Loss
Phase Imbalance
Communication Loss
```

---

# 42. Machine Monitoring Dashboard

Ví dụ:

```text
Machine State
Runtime
Downtime
Cycle Count
Cycle Time
Production Count
Temperature
Motor Current
Vibration
Power
Energy
```

---

# 43. Area Dashboard

Area dashboard aggregate:

```text
Machines

Running
Stopped
Fault
Offline

Current Power
Energy Today

Active Alarms
Runtime

Production
```

---

# 44. Factory Dashboard

Factory level:

```text
Factory Health

Total Machines
Running Machines

Total Load
Energy

Peak Demand

Production

Active Alarms

Energy by Area

Runtime by Area

Top Energy Consumers

Top Alarm Machines
```

---

# 45. Map / Floor Plan

Có thể upload:

```text
Factory layout
Floor plan
Electrical single-line diagram
Process diagram
```

Sau đó đặt entity lên diagram.

Ví dụ:

```text
[Compressor 01]

Green = Running
Red = Alarm
Grey = Offline
```

Click sẽ mở dashboard.

---

# 46. Electrical Single Line Diagram

Cho phép tạo mimic:

```text
GRID
 |
VCB
 |
Transformer
 |
MDB
 |---------|
MCC-01    MCC-02
```

Data realtime hiển thị ngay trên diagram.

Ví dụ:

```text
22.1 kV
843 kW
PF 0.94
```

Breaker thay đổi trạng thái theo telemetry.

---

# 47. Command & Control

Nếu project cho phép điều khiển:

```text
Start
Stop
Reset
ON
OFF
Setpoint
Schedule
```

Nhưng phải tách rõ:

```text
Monitoring

Control
```

Control cần:

```text
Permission
Confirmation
Audit log
Timeout
Command feedback
Interlock
```

Ví dụ:

```text
START MOTOR?

Target:
Pump 03

Current state:
STOPPED

[Cancel]
[Confirm]
```

Không cho dashboard gửi command một cách âm thầm.

---

# 48. User & Role Management

Role:

```text
System Admin
Tenant Admin
Engineer
Operator
Maintenance
Manager
Viewer
Customer
```

Permission:

```text
View Dashboard
Edit Dashboard
View Device
Edit Device
Control Device
Acknowledge Alarm
Configure Alarm
Manage Users
Export Data
```

---

# 49. Permission theo Entity

Ví dụ:

```text
Operator Area A
```

chỉ thấy:

```text
Area A
```

Không thấy:

```text
Area B
Area C
```

Customer A chỉ nhìn thấy factory của Customer A.

---

# 50. Multi-Tenant

Nếu platform dùng cho nhiều khách hàng:

```text
Platform

├ Tenant A
│ ├ Factory 1
│ └ Factory 2
│
├ Tenant B
│ └ Factory 1
│
└ Tenant C
```

Data, dashboards và users phải được isolation.

---

# 51. Reporting

Cho phép tạo:

```text
Daily Report
Weekly Report
Monthly Report
Energy Report
Alarm Report
Runtime Report
Device Health Report
```

Report có thể:

```text
View
PDF
Excel
CSV
Email
```

---

# 52. Scheduled Report

Ví dụ:

```text
Every Monday 08:00

Send:
Weekly Energy Report

To:
Factory Manager
```

---

# 53. Data Export

User có thể export:

```text
Raw Data
Aggregated Data
Alarm
Runtime
Energy
```

CSV / Excel.

---

# 54. Event Log

Không phải mọi event đều là alarm.

Ví dụ:

```text
Machine Started
Machine Stopped
Operator Login
Setpoint Changed
Device Connected
Firmware Updated
Configuration Changed
```

Event history:

```text
Timestamp
Entity
Event
User
Value
```

---

# 55. Audit Log

Mọi thao tác quan trọng phải được lưu.

Ví dụ:

```text
User A

14:32

Changed:
Alarm Threshold

From:
80°C

To:
90°C
```

Đặc biệt cần cho:

```text
Control
Alarm configuration
Device configuration
Dashboard changes
User management
```

---

# 56. Maintenance

Entity có Maintenance Mode.

Ví dụ:

```text
Machine 03

Maintenance
14:00 → 16:00
```

Trong thời gian này:

```text
không tính downtime
```

hoặc:

```text
suppress selected alarms
```

tùy cấu hình.

---

# 57. Notes & Annotation

Engineer có thể ghi chú trên timeline:

```text
14:32

Machine stopped to replace bearing.

— Nguyen Van A
```

Trend chart cũng cho annotation:

```text
Motor replaced
Firmware updated
Maintenance
```

để đối chiếu biến động dữ liệu.

---

# 58. Dashboard Variables

Dashboard nên có variables như:

```text
$factory
$area
$line
$machine
$device
$metric
$time_range
```

Ví dụ một dashboard:

```text
/device/$device
```

có thể hiển thị bất kỳ device nào.

Đây là nền tảng để tránh hard-code.

---

# 59. Dashboard Context

Mỗi dashboard nhận:

```text
entity_id
entity_type
profile_id
parent_id
time_range
```

Widget query dựa trên context.

Ví dụ:

```text
MetricCard

Entity:
$currentEntity

Data:
active_power
```

Không chứa ID cụ thể.

---

# 60. Widget Binding

Widget có thể bind:

```text
Current Entity

Parent Entity

Children

Descendants

Entity Type

Entity Group

Selected Entity

Custom Query
```

Ví dụ:

```text
Device Table

source =
Children of Current Entity

filter =
device_type = ENERGY_METER
```

Nếu ngày mai thêm meter mới vào Area A, table tự xuất hiện thiết bị đó.

---

# 61. Dashboard Inheritance

Ví dụ:

```text
Base Machine Dashboard
        ↓
CNC Dashboard
        ↓
Customer A CNC Dashboard
```

Customer có thể override một vài widget mà không cần copy toàn dashboard.

---

# 62. Template Versioning

Dashboard Template có version:

```text
Machine Template v1
Machine Template v2
Machine Template v3
```

Có thể update toàn bộ machine đang dùng template.

Không phải vào sửa từng machine.

---

# 63. Configuration as Data

Một nguyên tắc kiến trúc quan trọng:

Những thứ sau phải nằm trong database/configuration:

```text
Entity types

Device profiles

Telemetry schema

Dashboard layout

Widget config

Alarm rules

Calculated fields

Units

Thresholds

Permissions

Navigation
```

Không nằm trong source code frontend.

---

# 64. Example Dashboard JSON

Một widget có thể lưu:

```json
{
  "type": "value-card",
  "title": "Active Power",
  "entity": "$currentEntity",
  "metric": "active_power",
  "unit": "kW",
  "aggregation": "last",
  "precision": 1
}
```

Trend:

```json
{
  "type": "timeseries",
  "title": "Voltage",
  "entity": "$currentEntity",
  "metrics": [
    "voltage_l1",
    "voltage_l2",
    "voltage_l3"
  ]
}
```

Như vậy UI render từ configuration thay vì component viết riêng cho từng project.

---

# 65. Global Navigation

Sidebar nên có dạng:

```text
Overview

Assets

Dashboards

Alarms

Trends

Reports

Devices

Gateways

Analytics

Administration
```

---

# 66. Assets

Assets page có:

```text
Tree View

List View

Map View
```

Tree:

```text
Factory
 ├ Area
 │ ├ Line
 │ │ └ Machine
```

Click entity mở detail dashboard.

---

# 67. Overview Dashboard đề xuất

Màn hình chính có thể bố trí:

```text
┌────────────────────────────────────────────────────┐
│ Factory / Area Filter                Last 24 Hours │
├─────────┬─────────┬─────────┬─────────┬────────────┤
│ Devices │ Running │ Stopped │ Fault   │ Offline    │
│ 128     │ 102     │ 18      │ 5       │ 3          │
├─────────┴─────────┴─────────┴─────────┴────────────┤
│                                                   │
│         Machine Status Overview                   │
│                                                   │
├───────────────────────┬───────────────────────────┤
│ Current Load          │ Energy Today              │
│ 742 kW                │ 8.42 MWh                  │
├───────────────────────┼───────────────────────────┤
│ Energy Trend          │ Runtime Trend             │
│                       │                           │
├───────────────────────┼───────────────────────────┤
│ Active Alarms         │ Alarm History             │
│                       │                           │
├───────────────────────┼───────────────────────────┤
│ Top Energy Consumers  │ Top Downtime Machines     │
│                       │                           │
└───────────────────────┴───────────────────────────┘
```

---

# 68. Individual Machine Dashboard

```text
┌────────────────────────────────────────────────────┐
│ CNC-03                      RUNNING ●              │
│ Area A / Line 2                    Last seen 2s    │
├─────────────┬─────────────┬─────────────┬──────────┤
│ Runtime     │ Downtime    │ Power       │ Energy   │
│ 7h 21m      │ 32m         │ 12.3kW      │ 83kWh    │
├─────────────┴─────────────┴─────────────┴──────────┤
│                                                  │
│ Machine State Timeline                           │
│                                                  │
├─────────────────────────┬────────────────────────┤
│ Power Trend             │ Motor Current          │
│                         │                        │
├─────────────────────────┼────────────────────────┤
│ Temperature             │ Vibration              │
│                         │                        │
├─────────────────────────┴────────────────────────┤
│ Active Alarm                                     │
│                                                  │
├──────────────────────────────────────────────────┤
│ Connected Devices                                │
│ PLC | VFD | Meter | Sensor                       │
└──────────────────────────────────────────────────┘
```

---

# 69. Individual Electrical Panel Dashboard

```text
MDB-01
ONLINE

Voltage

L1 229.3 V
L2 230.1 V
L3 228.7 V

Current

L1 310 A
L2 295 A
L3 322 A

Active Power
204 kW

Power Factor
0.95

Frequency
50.02 Hz

Energy Today
1.84 MWh
```

Bên dưới:

```text
Voltage Trend

Current Trend

Power Trend

Energy Trend

Breaker Status

Power Quality

Alarm History
```

---

# 70. Data Retention

Admin configure:

```text
Raw Data:
30 days

1-minute:
6 months

15-minute:
2 years

1-hour:
5 years
```

Không cần giữ raw telemetry vô hạn.

---

# 71. Performance

Platform phải được thiết kế để scale:

```text
10 devices

100 devices

1,000 devices

10,000+ devices
```

Dashboard không được query toàn bộ raw telemetry mỗi lần mở.

Cần:

```text
aggregation
cache
time-series indexing
downsampling
pagination
WebSocket subscriptions
```

---

# 72. System Health

Admin dashboard phải có:

```text
Connected Devices

Messages/sec

MQTT Connections

Database Health

API Latency

Storage

CPU

RAM

Gateway Status

Failed Messages
```

---

# 73. API

Hệ thống cung cấp API cho integration:

```text
REST API

WebSocket API

Webhook

MQTT
```

Ví dụ:

```text
GET /api/entities

GET /api/entities/{id}

GET /api/entities/{id}/telemetry

GET /api/alarms

POST /api/devices
```

---

# 74. Integration

Có khả năng kết nối:

```text
ERP
MES
SCADA
BMS
CMMS
Energy Management
Data Warehouse
AI Platform
```

---

# 75. AI/Advanced Analytics – giai đoạn sau

Kiến trúc nên chừa khả năng cho:

```text
Anomaly Detection

Predictive Maintenance

Energy Baseline

Energy Forecast

Alarm Correlation

Fault Detection

Machine Behavior Analysis
```

Ví dụ:

```text
Compressor 03

Power consumption is
18% higher than its
30-day baseline.
```

---

# 76. Nguyên tắc UI

Người vận hành cần nhìn dashboard trong vài giây và biết:

```text
Có vấn đề gì?

Ở đâu?

Mức độ nghiêm trọng?

Xảy ra từ khi nào?

Giá trị hiện tại bao nhiêu?

Tôi cần click vào đâu?
```

Do đó tránh dashboard chỉ có hàng chục chart.

Ưu tiên hierarchy:

```text
STATUS
↓
PROBLEM
↓
LOCATION
↓
DETAIL
↓
HISTORY
```

---

# 77. Kiến trúc tổng thể đề xuất

```text
                FIELD
                  │
 ┌──────────────────────────────────┐
 │ PLC / Meter / Sensor / VFD       │
 └──────────────────────────────────┘
                  │
       Modbus / OPC UA / BACnet
                  │
                  ▼
             EDGE GATEWAY
                  │
       MQTT / HTTPS / WebSocket
                  │
                  ▼
        ┌──────────────────┐
        │ IoT Ingestion    │
        └──────────────────┘
                  │
                  ▼
        ┌──────────────────┐
        │ Data Normalizer  │
        └──────────────────┘
                  │
       ┌──────────┴──────────┐
       ▼                     ▼
 Time-Series DB          Entity DB
       │                     │
       └──────────┬──────────┘
                  ▼
             Rule Engine
                  │
       ┌──────────┼─────────┐
       ▼          ▼         ▼
    Alarm      Formula   Aggregation
       │          │         │
       └──────────┴─────────┘
                  ▼
               API
                  │
                  ▼
         Dashboard Engine
                  │
         Dynamic Templates
                  │
                  ▼
        Web / Tablet / Mobile
```

---

# 78. Data Model cốt lõi

Backend có thể xem các object sau là first-class entities:

```text
Tenant

User
Role

Entity
EntityType
EntityRelation

Device
DeviceProfile

DataPoint
Telemetry

CalculatedMetric

Alarm
AlarmRule

Event

Dashboard
DashboardTemplate
Widget

Gateway

Report

AuditLog
```

---

# 79. Luồng thêm một nhà máy mới

Admin:

```text
Create Factory
Factory HCM
```

↓

```text
Create Area
Utility
Production A
Production B
```

↓

```text
Create Machines
```

↓

```text
Assign Machine Profiles
```

↓

```text
Add Devices
```

↓

```text
Assign Device Profiles
```

↓

```text
Map Telemetry
```

↓

```text
Dashboards automatically available
```

Frontend không thay đổi.

---

# 80. Luồng thêm một loại thiết bị hoàn toàn mới

Ví dụ ngày mai cần:

```text
Water Quality Sensor
```

Admin tạo:

```text
Device Profile:
Water Quality Sensor
```

Data Points:

```text
pH
TDS
conductivity
temperature
```

Alarm:

```text
pH < 6
pH > 8
```

Dashboard Template:

```text
pH KPI
TDS KPI
Trend
Alarm History
```

Sau đó mọi Water Quality Sensor mới có thể sử dụng template này.

Không cần release phiên bản frontend mới.

---

# 81. Mục tiêu UX cuối cùng

Người dùng bình thường:

```text
Overview
↓
Thấy Area A có 3 máy Fault
↓
Click Area A
↓
Thấy CNC-03 Fault
↓
Click CNC-03
↓
Thấy Motor Overcurrent
↓
Mở trend
↓
Xem dòng điện trước khi fault
↓
Xem alarm history
```

Không cần biết:

```text
Device ID
MQTT Topic
Modbus Register
Database
```

---

# 82. Ba lớp cần tách biệt

Toàn bộ platform nên tách thành:

## Physical Layer

```text
PLC
Sensor
Meter
VFD
Gateway
```

## Semantic Layer

```text
Factory
Area
Machine
Device

Telemetry
State
Alarm
KPI
```

## Presentation Layer

```text
Dashboard
Widget
Chart
Report
```

Ví dụ:

```text
Modbus register 40021
```

thuộc Physical Layer.

Nó được chuyển thành:

```text
active_power
```

ở Semantic Layer.

Dashboard chỉ biết:

```text
active_power
```

Đây chính là cơ chế giúp platform không bị hard-code.

---

# 83. Nguyên tắc thiết kế bắt buộc

Nếu chỉ giữ lại vài nguyên tắc quan trọng nhất thì phải là:

**1. Entity-driven**

Dashboard làm việc với entity chứ không với device ID cố định.

**2. Profile-driven**

Thiết bị/máy cùng loại dùng chung profile.

**3. Template-driven**

Dashboard dùng template có thể reuse.

**4. Schema-driven telemetry**

Frontend sử dụng semantic key như `active_power`, không sử dụng register hoặc MQTT topic.

**5. Hierarchical aggregation**

Factory → Area → Line → Machine → Device có thể drill-down và aggregate.

**6. Configuration over code**

Dashboard, alarm, metric, threshold, hierarchy và widget phải được cấu hình từ UI/database.

**7. Reusable widgets**

Widget chỉ cần biết:

```text
entity + metric + configuration
```

**8. Clear separation between monitoring and control**

Read telemetry và gửi command là hai quyền hoàn toàn khác nhau.

---

# 84. Định nghĩa sản phẩm ngắn gọn

Có thể mô tả sản phẩm bằng một câu:

> **A configurable, entity-driven IIoT monitoring platform that allows factories, areas, machines, electrical panels and devices to be modeled dynamically and monitored through reusable dashboards, templates, alarms and analytics without application-specific hard-coding.**

Hoặc theo góc độ developer:

> **Create the platform once; configure each industrial application instead of coding it again.**

Đây nên là triết lý kiến trúc xuyên suốt của toàn bộ sản phẩm.