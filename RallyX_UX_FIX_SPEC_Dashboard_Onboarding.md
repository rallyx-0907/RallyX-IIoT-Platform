# RallyX IIoT Platform — Đặc tả sửa UX: Dashboard & luồng dữ liệu thiết bị

- Nhánh review: `feat/platform-mvp` (commit `f75fab5`)
- Ngày: 29/10/2026
- Mục tiêu: người ít chuyên môn đi từ **thiết bị mới → thấy số trên dashboard trong 1–3 bước**, không phải hiểu "entity / profile / binding / adapter".
- Phạm vi: chỉ mô tả cần sửa gì, chưa có code. V1 vẫn chỉ đọc (read-only).

---

## 0. Hiện trạng

Từ một thiết bị Modbus mới đến lúc thấy dashboard hiện mất **8–9 bước qua 5–6 trang**:

| # | Trang | Thao tác |
|---|---|---|
| 1 | Tài sản | Phải có sẵn nhà máy / khu vực / máy |
| 2 | Kết nối | Thêm kết nối (site, giao thức, IP/port, chu kỳ, timeout), lưu rồi test |
| 3 | Mẫu thiết bị | (Tùy chọn) khai báo tag: key, đơn vị, địa chỉ, function code, byte/word order |
| 4 | Thiết bị | Thêm thiết bị: tài sản, kết nối, mẫu, slave ID |
| 5 | Cấu hình tín hiệu | Nếu không dùng mẫu thì nhập từng tag hoặc import CSV |
| 6 | Bảng điều khiển | Thêm thực thể: loại, cha, "vai trò nguồn" |
| 7 | | Tạo profile: **khai báo lại** key, đơn vị, số lẻ, lưu lịch sử |
| 8 | | Map tín hiệu: chọn nguồn cho **từng** đại lượng |
| 9 | | Thiết kế template: thêm widget, xem trước, áp dụng |

**Mục tiêu sau khi sửa:** bước 1–9 gói trong một wizard 3 bước (mục P1). Các trang cấu hình chi tiết vẫn giữ lại cho kỹ sư.

---

## Mức ưu tiên

- **P0**: lỗi gây bối rối hoặc chặn người dùng. Nhỏ, sửa ngay.
- **P1**: thay đổi luồng chính để đạt 1–3 bước.
- **P2**: bố cục và thuật ngữ.
- **P3**: nâng cao, làm sau.

---

## P0 — Sửa ngay

### P0-1. So khớp đơn vị quá chặt khiến nguồn "biến mất"

- **Vấn đề:** khi map tín hiệu, dropdown chỉ hiện tag có đơn vị **trùng tuyệt đối** với profile. Ví dụ profile ghi `kW`, tag ghi `kw` hoặc `kW ` (có dấu cách) thì tag không hiện, và giao diện không báo lý do.
- **Vị trí:**
  - `apps/web/src/pages/entities/EntitySetup.tsx` → `BindingEditor`: bộ lọc `s.unit===m.unit`.
  - `apps/core/internal/storage/entity_profiles.go` → `SaveEntityBindings`: `unit != m.Unit`.
  - `apps/core/internal/storage/entity_runtime.go`: dòng so `source.Unit != source.MetricUnit`. Dòng này **cũng phải sửa**, nếu không lưu được mapping nhưng runtime vẫn báo lỗi.
  - Khi tổng hợp nhiều đơn vị (`units[...]`) và khi so `Presentation.Unit`: dùng cùng quy tắc chuẩn hóa.
- **Cần sửa:** dùng **một** hàm chuẩn hóa đơn vị chung cho cả Core và Web: bỏ khoảng trắng đầu/cuối và không phân biệt hoa thường. Có thể thêm bảng đồng nghĩa nhỏ: `°C`/`degC`, `m3/h`/`m³/h`, `%`/`pct`.
- **Nghiệm thu:** profile `kW` map được tag `kw` và `kW `. Dashboard hiện giá trị với trạng thái "Tốt". Có unit test Go cho hàm chuẩn hóa.

### P0-2. Hiện lý do khi nguồn không chọn được

- **Vấn đề:** nguồn sai kiểu, sai đơn vị hoặc chưa bật lưu lịch sử bị ẩn hoàn toàn.
- **Cần sửa:** vẫn hiện các nguồn đó trong danh sách nhưng **làm mờ, không chọn được**, kèm lý do ngắn, ví dụ:
  - "Khác đơn vị: tag = A, cần kW"
  - "Kiểu Logic, cần Số"
  - "Chưa bật lưu lịch sử — bật tại Cấu hình tín hiệu"

  Khi không có nguồn nào hợp lệ thì hiện link sang trang sửa tag tương ứng.
- **Nghiệm thu:** người dùng luôn thấy được tag của thiết bị mình vừa tạo, và biết vì sao chưa chọn được.

### P0-3. Bỏ thông tin thừa trên ô widget

- **Vị trí:** `apps/web/src/pages/entities/NativeWidgets.tsx` (chân widget).
- **Cần sửa:**
  - Chỉ hiện "x/y nguồn tốt" khi widget tổng hợp từ **≥ 2 nguồn**, hoặc khi có nguồn lỗi (good < expected).
  - Widget 1 nguồn chỉ cần trạng thái và giờ cập nhật.
- **Nghiệm thu:** ảnh `docs/screenshots/native-entity-dashboard.png` không còn 10 dòng "1/1 nguồn tốt".

### P0-4. Tên hiển thị thô trên dashboard

- **Vấn đề:** ô hiện "Thanh ghi 0 (HR 40001)", tức là tên kỹ thuật lọt ra màn hình vận hành.
- **Cần sửa:**
  - Widget mặc định lấy **tên đại lượng trong profile/mẫu** (vd. "Công suất tác dụng"), không lấy tên tag.
  - Địa chỉ thanh ghi chỉ hiện ở tooltip hoặc chế độ kỹ sư.

---

## P1 — Đạt 1–3 bước

### P1-1. Wizard "Thêm thiết bị nhanh" (luồng chính mới)

Đặt nút **"+ Thêm thiết bị"** ở trang Bảng điều khiển và trang Tổng quan. Wizard có 3 bước:

1. **Kết nối**
   - Chọn giao thức (Modbus TCP / RTU / MQTT / Mô phỏng).
   - Chọn kết nối có sẵn **hoặc** tạo mới ngay trong bước này (IP, port, slave ID).
   - Chu kỳ đọc và timeout để giá trị mặc định, ẩn vào mục "Nâng cao".
   - Có nút **Kiểm tra**, hiển thị kết quả dễ hiểu ("Đã kết nối, phản hồi 12 ms" / "Không tới được 192.168.1.10:502").
2. **Chọn mẫu thiết bị**
   - Danh sách mẫu có ảnh/hãng/model (vd. "Đồng hồ điện 3 pha", "Biến tần").
   - Sau khi chọn, hệ thống **đọc thử ngay** tất cả tag (dùng `test-read` đã có) và hiện bảng giá trị thật kèm chất lượng.
   - Có lựa chọn "Không có mẫu", dẫn tới P1-4 (tự dò).
3. **Đặt vị trí và đặt tên**
   - Chọn nhà máy → khu vực → máy, hoặc tạo mới ngay trong dropdown.
   - Đặt tên thiết bị.
   - Bấm **Hoàn tất** thì hệ thống tự tạo: thiết bị, tag, thực thể, gán profile, map tín hiệu, gán dashboard mặc định. Sau đó mở thẳng dashboard của thiết bị.

**Nghiệm thu:** từ một Modbus Slave mô phỏng, người chưa đọc tài liệu thấy số trên dashboard trong ≤ 3 màn hình, ≤ 2 phút, và không phải nhập metric key, function code hay byte order.

### P1-2. Gộp "Mẫu thiết bị" và "Profile"

- **Vấn đề:** cùng một danh sách đại lượng (key, tên, đơn vị, số lẻ, lưu lịch sử) phải khai báo 2 lần: tag definitions trong Mẫu thiết bị, rồi metrics trong Profile.
- **Cần sửa:**
  - Khi lưu Mẫu thiết bị, hệ thống **tự sinh hoặc cập nhật profile** tương ứng (cùng key, tên, đơn vị, kiểu, lưu lịch sử). Người dùng không phải mở trình tạo profile.
  - Màn hình "Tạo profile" chỉ còn cho trường hợp nâng cao: nhóm logic, máy ảo tổng hợp nhiều thiết bị.
  - Profile sinh từ mẫu ghi rõ nguồn gốc: "Tạo từ mẫu: Đồng hồ điện 3 pha v2".

### P1-3. Tự động map tín hiệu

- Khi thiết bị tạo từ mẫu được gán vào thực thể có profile của mẫu đó thì **tự map theo key**, không cần mở "Map tín hiệu".
- Trong màn hình Map tín hiệu (trường hợp thủ công), thêm nút **"Tự gợi ý"**:
  - Ghép theo key trùng, sau đó theo tên gần giống, chỉ lấy nguồn tương thích (sau P0-1).
  - Đánh dấu dòng nào là gợi ý để người dùng kiểm tra trước khi bấm Áp dụng.
- **Nghiệm thu:** 10 đại lượng cùng key được map tự động 10/10. Màn hình hiện "Đã tự map 10/10".

### P1-4. Dò tín hiệu khi không có mẫu

- **MQTT:** nút **"Nghe thử 10–30 giây"** trên kết nối. Hệ thống liệt kê các topic và khóa JSON nhận được, kèm giá trị mẫu. Người dùng tick để tạo tag; kiểu dữ liệu và đơn vị được đoán sẵn và có thể sửa.
- **Modbus:** nút **"Quét dải thanh ghi"**, đọc thử một dải (vd. HR 40001–40050) rồi hiện bảng giá trị raw và decoded để tick chọn. Vẫn chỉ đọc.
- Từ các tag đã chọn có nút **"Lưu thành mẫu thiết bị"** để dùng lại cho máy sau.

### P1-5. Dashboard mặc định luôn có sẵn

- Cơ chế `default_template` của profile đã có trong Core. Cần đảm bảo **mọi mẫu thiết bị đều có dashboard mặc định** sinh tự động:
  - Số → ô chỉ số + 1 biểu đồ xu hướng chung.
  - Logic chạy/lỗi → ô trạng thái.
- Người dùng chỉ mở trình thiết kế kéo thả khi muốn tùy biến.

---

## P2 — Bố cục và thuật ngữ

### P2-1. Gom sidebar thành 2 nhóm

Sidebar hiện có 12 mục ngang hàng (`apps/web/src/App.tsx`, mảng `pages`). Chia lại:

- **Vận hành:** Bảng điều khiển, Tổng quan, Cảnh báo, Lịch sử & xu hướng, Dữ liệu trực tiếp
- **Cài đặt** (thu gọn được): Thiết bị, Kết nối, Mẫu thiết bị, Cấu hình tín hiệu, Quy tắc, Hệ thống

Với vai trò operator/viewer: mặc định thu gọn nhóm Cài đặt, hoặc ẩn các mục chỉ admin mới sửa được.

### P2-2. Tách chế độ xem và chế độ chỉnh sửa trên dashboard

- Màn hình dashboard hiện có 2 hàng nút cấu hình:
  - Thêm thực thể / Tạo profile / Thư viện dashboard
  - Cấu hình entity / Map tín hiệu / Thiết kế kéo thả
- **Cần sửa:** gom tất cả vào **một nút "Chỉnh sửa"** (menu thả xuống), chỉ admin thấy. Chế độ xem chỉ giữ: chọn khoảng thời gian, làm mới, tab.

### P2-3. Thống nhất giao diện sáng/tối

- Khung dashboard nền tối nằm trong trang nền sáng nên trông như 2 ứng dụng ghép lại.
- **Cần sửa:** chọn một chủ đề cho toàn trang, hoặc cho phép bật chế độ tối cho cả trang (dùng chung token màu trong `theme.css`).

### P2-4. Cây thực thể bên trái

- Cho phép **thu gọn** cây thực thể.
- Khi chỉ có ít mục thì hiển thị dạng breadcrumb/dropdown, để dashboard có thêm chỗ.

### P2-5. Phân cấp thị giác của widget

- 10 ô cùng cỡ, cùng màu, giá trị 0 và giá trị thật trông giống nhau.
- **Cần sửa:**
  - Dashboard mặc định đặt 2–4 đại lượng chính (công suất, trạng thái chạy, lỗi) ở hàng đầu với cỡ lớn hơn.
  - Đại lượng phụ dùng ô nhỏ hoặc bảng.

### P2-6. Chỉ một loại dashboard

- Hiện có 3 hệ song song: dashboard native theo thực thể, dashboard point qua Grafana (`DashboardComposer`), và "bảng theo dõi đơn giản đã lưu".
- **Cần sửa:**
  - Native là mặc định duy nhất trong luồng chính.
  - Grafana chuyển thành mục "Báo cáo nâng cao" trong Cài đặt.
  - Có công cụ chuyển bảng cũ sang native, sau đó ẩn trình tạo bảng cũ.

### P2-7. Thuật ngữ tiếng Việt thống nhất

Bỏ trộn Anh–Việt trên giao diện vận hành. Đề xuất bảng từ:

| Hiện tại | Đổi thành |
|---|---|
| Entity / Thực thể | Vị trí / Máy (tùy cấp) |
| Profile / Profile ngữ nghĩa | Bộ đại lượng (ẩn với người dùng thường, xem P1-2) |
| Metric key | Mã đại lượng (sinh tự động từ tên) |
| Map tín hiệu / binding | Gán nguồn dữ liệu |
| Template (dashboard) | Mẫu dashboard |
| Template (thiết bị) / adapter | Mẫu thiết bị |
| Cấu hình entity | Cài đặt máy |
| ENTITY · PROFILE · TEMPLATE (eyebrow) | Bỏ |
| COUNT · Số nguồn tốt | Đếm số nguồn đang tốt |

Ngoài ra **không dùng chữ "Template" cho 2 khái niệm khác nhau**.

### P2-8. Gộp hai hệ phân cấp

- Trang Tài sản (site/area/asset) và cây Thực thể cùng mô tả nhà máy → khu vực → máy.
- Ô "Vai trò nguồn" (Cơ sở dùng cho kết nối / Máy sở hữu thiết bị / …) khó hiểu.
- **Cần sửa:**
  - Chỉ còn **một cây vị trí**.
  - Hệ thống tự suy ra vai trò vật lý: nút có thiết bị con là máy, nút gốc là nhà máy.
  - Bỏ ô "Vai trò nguồn" khỏi form thường, chỉ giữ trong chế độ nâng cao.

---

## P3 — Làm sau

- **Trạng thái trống có hướng dẫn:** khi chưa có thiết bị, trang Bảng điều khiển hiện checklist 3 bước kèm nút bắt đầu wizard.
- **Thông báo lỗi kết nối dễ hiểu:** chuyển lỗi kỹ thuật thành câu gợi ý. Ví dụ "timeout" → "Thiết bị không phản hồi — kiểm tra IP, cáp mạng, slave ID".
- **Nhân bản máy:** từ một máy đã cấu hình, bấm "Thêm máy giống thế này" thì chỉ cần nhập IP/slave ID mới.
- **Import hàng loạt:** dùng CSV danh sách thiết bị (tên, vị trí, IP, slave ID, mẫu) để tạo nhiều máy một lần.

---

## Kiểm thử chấp nhận tổng thể

1. Người chưa dùng RallyX thêm được một Modbus Slave mô phỏng và thấy dashboard trong **≤ 3 bước**, không cần mở tài liệu.
2. Thêm máy thứ 2 cùng loại chỉ mất **1 bước** (nhân bản hoặc wizard với mẫu có sẵn).
3. Không bước nào trong luồng chính yêu cầu nhập metric key, function code, byte/word order hay chọn "vai trò nguồn".
4. Đơn vị khác hoa thường hoặc có khoảng trắng không làm mất nguồn. Mọi nguồn không chọn được đều có lý do.
5. Operator chỉ thấy nhóm Vận hành và dashboard ở chế độ xem.
6. Các kiểm thử hiện có (Core/DB/MQTT, Web, e2e) vẫn qua. Dữ liệu và dashboard cũ không bị mất.

## Ghi chú

- Review dựa trên mã nguồn, tài liệu và ảnh chụp trong repo. Chưa chạy thử toàn hệ thống.
- Thứ tự gợi ý: P0 (vài ngày) → P1-2 + P1-3 → P1-1 → P2 → P1-4 → P3.
