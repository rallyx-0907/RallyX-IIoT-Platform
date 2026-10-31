# Kết quả sửa review Dashboard / Onboarding

Nguồn yêu cầu: RallyX_UX_FIX_SPEC_Dashboard_Onboarding.md. Phạm vi triển khai: P0, P1, P2; import danh sách thiết bị hàng loạt của P3 còn để sau.

| Nhóm | Kết quả |
|---|---|
| P0 | Chuẩn hóa đơn vị dùng chung Core/Web; hiện nguồn không tương thích kèm lý do và link sửa; bỏ 1/1 nguồn tốt; ưu tiên tên đại lượng và ẩn địa chỉ thanh ghi trên màn hình vận hành. |
| P1 | Thêm thiết bị ba bước; kiểm tra kết nối/đọc thử không lưu nháp; quét Modbus chỉ đọc ≤50 thanh ghi; nghe MQTT 10–30 giây; sửa và chọn tín hiệu; hoàn tất một giao dịch có chống tạo trùng. |
| P1 | Mẫu thiết bị tự sinh bộ đại lượng, gán nguồn và dashboard mặc định có phiên bản. Máy đã cấu hình giữ phiên bản cũ. Gợi ý nguồn kiểm tra mọi trang kết quả và không tự chọn khi có nhiều ứng viên phù hợp. |
| P2 | Sidebar Vận hành/Cài đặt; chỉ admin thấy Chỉnh sửa; giao diện sáng thống nhất, màu rõ hơn, cây vị trí thu gọn; chỉ số chính lớn, tín hiệu phụ và xu hướng chia tab. |
| P2 | Native là luồng chính. Trình tạo bảng cũ được ẩn; công cụ chuyển bảng cá nhân sang bản native dùng chung giữ lại bảng gốc, điểm dữ liệu và lịch sử. |
| Thuật ngữ | Vị trí/máy, bộ đại lượng, gán nguồn dữ liệu, mẫu dashboard; mã đại lượng tự sinh, vai trò vật lý nằm trong phần nâng cao. |

## Bằng chứng kiểm thử

- Web: 120 kiểm thử qua; production build qua. Các kiểm thử đích chạy lại sau sửa cuối.
- Core: toàn bộ bộ kiểm thử với PostgreSQL/TimescaleDB và broker MQTT qua, gồm migration, phân quyền, rule engine, lịch sử, unit aliases và onboarding. Kiểm thử đích xác minh lại chuyển bảng, phiên bản mẫu, chống tạo trùng và đơn vị.
- Connectivity: 25 kiểm thử qua, 1 kiểm thử tích hợp riêng được bỏ qua do không cấp biến môi trường cho bài đó. Luồng tương đương được kiểm chứng bằng bài nghiệm thu Chromium/Modbus/MQTT thật bên dưới.
- Hợp đồng: hai kiểm thử Node xác nhận topic/telemetry và bảng alias Core/Web giống nhau.
- Chromium trên stack preview riêng: thêm Modbus TCP trong ba màn hình, đọc thanh ghi qua socket, tự gán ba nguồn và mở native dashboard; thêm thiết bị cùng loại từ một màn hình; dò JSON MQTT và nhận 0/false đúng; chuyển bảng cũ và hủy wizard. Không có ghi xuống thiết bị.
- Chromium native: kéo/đổi kích thước thật bằng pointer, hoàn tác, xem trước/áp dụng, dùng chung mẫu ở nhiều máy, tổng hợp thiếu nguồn, drill-down cảnh báo, xuất/nhập, reload/tab mới và màn hình hẹp.
- Chromium hồi quy tổng thể: 11/11 qua, gồm cấu hình kết nối/mẫu/thiết bị, đọc Modbus, dữ liệu trực tiếp, lịch sử, import CSV 100 tín hiệu và mở lại bảng cũ ở chế độ chỉ xem.
- Demo: đối chiếu giữ nguyên 14 điểm dữ liệu, 3 thiết bị, 5 biểu đồ cũ và bảng “Bàn thử Modbus Slave”; mở lại bố cục người dùng đã lưu, lịch sử và tab mới. Không thay bố cục người dùng bằng bố cục kiểm thử.

## Giới hạn thực tế

- Nguồn Windows Modbus Slave đã cấu hình hiện không phản hồi: 10 điểm giữ trạng thái dữ liệu cũ; 4 điểm mô phỏng vẫn có dữ liệu tốt. Nghiệm thu Modbus mới dùng nguồn TCP riêng trong preview; không biến dữ liệu cũ thành dữ liệu tốt.
- Quét Modbus mặc định đọc uint16/Holding Register. Float, nhiều thanh ghi, byte/word order khác phải chọn mẫu phù hợp hoặc cấu hình kỹ thuật.
- Mẫu có thể có 1.000 tín hiệu; đọc thử tối đa 64 tín hiệu/yêu cầu. Dashboard mặc định giới hạn 48 ô giá trị và 8 biểu đồ xu hướng; các điểm còn lại vẫn có trong cấu hình.
- Đơn vị được chuẩn hóa về cách viết thông dụng, không tự đổi thang đo và không gộp các tiền tố SI khác nghĩa như mW/MW.
- Thêm thiết bị cùng loại một màn hình dùng kết nối hiện tại; đổi sang kết nối/IP khác qua bước Kết nối.
- Đây là nghiệm thu phần mềm; chưa thay thế kiểm chứng PLC/RTU vật lý, SaaS hoặc gói cài đặt offline.

Hướng dẫn sử dụng: [Dashboard và thêm thiết bị nhanh](dashboard-onboarding.md).

## Ảnh nghiệm thu

[Đọc thử và chọn tín hiệu](screenshots/dashboard-onboarding-preview.png) · [Đặt vị trí và tên](screenshots/dashboard-onboarding-location.png) · [Dashboard sau khi hoàn tất](screenshots/native-entity-dashboard.png).
