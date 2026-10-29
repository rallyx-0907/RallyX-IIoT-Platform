# Guided point dashboards

The dashboard entry page lists saved Grafana dashboards and keeps the sample gallery behind an explicit action. Administrators can create a real persisted dashboard by selecting device, point, visualization and name. Numeric points support trends, stat, gauge, bar gauge and table; Boolean and text points use current-value views. History-disabled points do not offer trends. Generated queries bind exactly one escaped point ID, include a quality/timestamp table and use the existing read-only reporting datasource and RallyX session. No new credentials or device writes.

Verification: unit interaction test creates through the Grafana API and opens its returned UID; query-builder tests cover fixed point filters and visualization choices; real browser acceptance creates and queries a saved point dashboard against isolated Grafana before demo rollout.

## Sử dụng

1. Vào **Bảng điều khiển**, chọn **Tạo dashboard cho một point**.
2. Chọn thiết bị, tìm và chọn point theo tên hoặc mã.
3. Chọn kiểu biểu đồ; nhập giới hạn dưới/trên nếu dùng đồng hồ hoặc thanh mức.
4. Đặt tên rồi chọn **Tạo và mở dashboard**.

Dashboard được lưu trong Grafana và xuất hiện ở **Dashboard của bạn** sau khi tải lại. Chọn **Chỉnh sửa nâng cao trong Grafana** để thêm panel, đổi bố cục và tùy chỉnh các kiểu biểu đồ khác. Tín hiệu không bật lưu lịch sử chỉ có thể xem giá trị hiện tại cho tới khi bật lịch sử trong cấu hình tín hiệu. Biểu đồ xu hướng mặc định xem một giờ gần nhất và cập nhật mỗi 5 giây.

## Kéo thả và nhiều point

Mở dashboard đã lưu rồi chọn **Tùy chỉnh / kéo thả**.

- Chọn **Thêm ô dữ liệu**, chọn thiết bị, point và kiểu hiển thị. Có thể thêm point từ nhiều thiết bị vào cùng dashboard.
- Kéo thanh tiêu đề của ô để chuyển vị trí trên lưới. Kéo góc dưới bên phải để đổi kích thước. Các ô va nhau sẽ được đẩy xuống.
- Chọn một ô để đổi tên, chiều rộng, chiều cao hoặc xóa ô. Phím mũi tên trên nút kéo cũng hỗ trợ sắp xếp và thay đổi kích thước.
- **Hoàn tác** khôi phục thao tác trước đó; **Lưu dashboard** ghi bố cục vào Grafana. Đóng trình chỉnh sửa để xem dữ liệu thật.

Nếu người khác đã lưu dashboard trong lúc anh đang chỉnh, hệ thống báo xung đột và giữ lại bản đang sửa, không ghi đè bản mới. Dashboard mẫu do cấu hình quản lý và các nhóm/row nâng cao dùng trình chỉnh sửa Grafana. Bố cục lưới có thể cuộn ngang trên màn hình nhỏ.
