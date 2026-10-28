# Guided point dashboards

The dashboard entry page lists saved Grafana dashboards and keeps the sample gallery behind an explicit action. Administrators can create a real persisted dashboard by selecting device, point, visualization and name. Numeric points support trends, stat, gauge, bar gauge and table; Boolean and text points use current-value views. History-disabled points do not offer trends. Generated queries bind exactly one escaped point ID, include a quality/timestamp table and use the existing read-only reporting datasource and RallyX session. No new credentials or device writes.

Verification: unit interaction test creates through the Grafana API and opens its returned UID; query-builder tests cover fixed point filters and visualization choices; real browser acceptance creates and queries a saved point dashboard against isolated Grafana before demo rollout.

## Sử dụng

1. Vào **Bảng điều khiển**, chọn **Tạo dashboard cho một point**.
2. Chọn thiết bị, tìm và chọn point theo tên hoặc mã.
3. Chọn kiểu biểu đồ; nhập giới hạn dưới/trên nếu dùng đồng hồ hoặc thanh mức.
4. Đặt tên rồi chọn **Tạo và mở dashboard**.

Dashboard được lưu trong Grafana và xuất hiện ở **Dashboard của bạn** sau khi tải lại. Chọn **Chỉnh sửa nâng cao trong Grafana** để thêm panel, đổi bố cục và tùy chỉnh các kiểu biểu đồ khác. Tín hiệu không bật lưu lịch sử chỉ có thể xem giá trị hiện tại cho tới khi bật lịch sử trong cấu hình tín hiệu. Biểu đồ xu hướng mặc định xem một giờ gần nhất và cập nhật mỗi 5 giây.
