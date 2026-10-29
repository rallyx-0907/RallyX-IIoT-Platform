# Dashboard theo phạm vi nhà máy

Mở **Bảng điều khiển** để xem các dashboard đã lưu trên thanh tab. Biểu đồ nằm ngay dưới tab; danh sách cấu hình không chiếm vùng xem. Các dashboard Grafana và bảng theo dõi đơn giản đã có vẫn được giữ nguyên.

## Tạo dashboard

1. Bấm **Tạo dashboard** để mở cửa sổ cấu hình riêng.
2. Nhập tên, lọc theo **Nhà máy → Khu vực → Máy / tài sản → Thiết bị**. Để “Tất cả” nếu muốn kết hợp nhiều máy.
3. Chọn các point và kiểu hiển thị riêng: chỉ số/trạng thái, xu hướng, đồng hồ, thanh mức hoặc bảng. Có thể chọn tối đa 24 point. Bộ lọc chỉ thu hẹp danh sách; các point đã chọn vẫn hiện ở cột bên phải để kiểm tra/bỏ chọn.
4. Với đồng hồ/thanh mức, nhập dải đo phù hợp. Dải này không tạo ngưỡng cảnh báo; cấu hình cảnh báo ở Rule Engine.
5. Bấm **Xem trước**. Số liệu lấy từ hệ thống; lịch sử xem một giờ gần nhất. Tín hiệu tắt, tắt realtime hoặc quá hạn không được coi là giá trị hiện tại tốt. Chưa có thao tác lưu ở bước này.
6. Bấm **Áp dụng** để lưu dashboard vào Grafana và thêm tab. **Hủy/Đóng** trước khi áp dụng không tạo dashboard.

Point logic/văn bản dùng chỉ số hoặc bảng. Xu hướng cần point số có bật lưu lịch sử. Đồng hồ và thanh mức không áp dụng cho Boolean/văn bản. Dashboard cập nhật mỗi 5 giây, dùng datasource báo cáo chỉ đọc và phiên đăng nhập RallyX hiện tại.

## Đổi bố cục

Chọn **Tùy chỉnh / kéo thả**. Cửa sổ riêng hiển thị bản xem dữ liệu trên lưới. Kéo thanh tiêu đề để di chuyển, kéo góc dưới phải để đổi kích thước; phím mũi tên cũng hỗ trợ. Chọn biểu đồ để đổi tên, kích thước hoặc bỏ khỏi dashboard. **Hoàn tác** khôi phục thao tác trước; **Lưu dashboard** áp dụng bố cục. Xung đột phiên bản giữ lại bản đang sửa và báo lỗi.

Các panel nâng cao hoặc dashboard mẫu được quản lý bằng cấu hình dùng liên kết **Grafana**. Không có thao tác ghi xuống thiết bị.

## Lưu và mở lại

Dashboard và bố cục được lưu trên máy chủ. Trình duyệt chỉ nhớ lựa chọn gần nhất riêng theo tài khoản. **Mở tab mới** mang đúng UID dashboard; tải lại vẫn mở đúng bảng. Nếu dashboard chưa xuất hiện trong chỉ mục tìm kiếm, hệ thống tải trực tiếp theo UID đã lưu. Khi danh sách tải lỗi, giao diện báo lỗi và không tự thay bằng một dashboard khác.

Dashboard Grafana dùng quyền của tổ chức cục bộ; các bảng theo dõi đơn giản cũ vẫn thuộc tài khoản đã tạo. V1 chưa có phân tách tenant SaaS.