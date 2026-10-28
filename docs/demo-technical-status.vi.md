# Trạng thái kỹ thuật demo — 28/10/2026

## Kết nối theo điểm dữ liệu

Modbus TCP và MQTT đã có adapter cấu hình động. Không cần viết adapter theo hãng hoặc model nếu thiết bị cung cấp dữ liệu theo các giao thức này.

1. Tạo kết nối: Modbus TCP cần host/cổng; MQTT cần broker/topic và thông tin xác thực nếu có.
2. Tạo thiết bị thuộc tài sản và chọn kết nối. Với Modbus, đặt Unit ID.
3. Tạo điểm dữ liệu: chọn kiểu, đơn vị và ánh xạ. Modbus cần function/address/byte order; MQTT cần đường dẫn trường JSON.
4. Dùng Kiểm tra kết nối và Đọc thử để đối chiếu raw/decoded/scaled trước khi theo dõi trực tiếp.
5. Dùng ID điểm dữ liệu trong quy tắc. Có thể kết hợp nhiều điểm từ các giao thức khác nhau.

Phần mềm không thể tự đoán ý nghĩa thanh ghi hoặc trường payload. Người cấu hình vẫn phải cung cấp ánh xạ và đơn vị đúng. Tích hợp trường trong phiên bản này chỉ đọc.

## Rule Engine

Đã triển khai đánh giá ALL/ANY, so sánh số/Boolean/chuỗi, mất dữ liệu, vùng trễ, độ trễ kích hoạt và kết thúc. Trạng thái chờ lưu trong PostgreSQL và được khôi phục khi Core khởi động. Thử quy tắc không tạo cảnh báo. Cảnh báo lưu snapshot kích hoạt/kết thúc và giữ nguyên ý nghĩa thao tác xác nhận.

Giao diện mới có biên tập nhiều điều kiện, thử trước khi lưu, bật/tắt, nhân bản và trạng thái đánh giá. Ngôn ngữ mặc định là tiếng Việt; giữ nguyên tên và mã dữ liệu do người dùng cấu hình.

## Bảng điều khiển và tín hiệu

Đã có mục Bảng điều khiển riêng, tạo nhiều bảng có tên theo tài khoản và lưu các ô giá trị/trạng thái/xu hướng/đồng hồ/thanh mức theo kiểu dữ liệu. Hỗ trợ sửa, thứ tự, độ rộng, đơn vị, số lẻ và dải hiển thị. Cấu hình tín hiệu có bộ lọc thiết bị, tìm tên/mã/địa chỉ, kiểu dữ liệu và phân trang 25 dòng. Có bảng mẫu `Bàn thử Modbus Slave` đọc slave Windows hiện có. Xem `dashboard-guide.vi.md`.

## Những gì còn phải nghiệm thu

- Thiết bị vật lý tại hiện trường: địa chỉ, mạng, bảng thanh ghi/payload, chứng chỉ và sai số thực tế chưa được cung cấp.
- Kiểm thử tải liên tục theo mức 500 quy tắc, 2.000 điểm và 100 cập nhật/giây của kế hoạch Rule Engine.
- Chạy dài, mất mạng/reconnect tại hiện trường và đóng gói phát hành ngoại tuyến theo toàn bộ roadmap.

Các chính sách lưu/xóa được để ngoài phạm vi đợt hoàn thiện kỹ thuật này theo yêu cầu người dùng. Không đánh dấu toàn bộ roadmap hoàn tất chỉ từ việc demo simulator chạy được.
