# Bảng điều khiển tùy chỉnh và quản lý tín hiệu

## Tạo dashboard nhiều thiết bị

Mở **Bảng điều khiển**, chọn **Tạo dashboard**. Cửa sổ riêng cho chọn phạm vi nhà máy/khu vực/máy/thiết bị, nhiều point và kiểu biểu đồ riêng; **Xem trước → Áp dụng** để thêm tab đã lưu. Xem [hướng dẫn dashboard](point-dashboard-workflow.md) để cấu hình và kéo thả.

## Bảng theo dõi đơn giản đã có

Chọn tab của bảng đã lưu để tiếp tục dùng bộ chỉ số cũ. Mỗi tài khoản có danh sách bảng đơn giản riêng; bảng trống vẫn được lưu. Các ô đã tạo trước nâng cấp nằm trong **Bảng mặc định**. Dashboard Grafana mới dùng quyền tổ chức cục bộ.

Trong biểu mẫu, chọn thiết bị và tìm tín hiệu, chọn điểm dữ liệu rồi chọn loại ô:

| Loại ô | Dữ liệu phù hợp | Cấu hình |
|---|---|---|
| Giá trị | Số, Boolean, chuỗi | Tiêu đề, số lẻ và đơn vị |
| Trạng thái | Boolean | Nhãn bật/tắt; màu theo ý nghĩa chạy/lỗi đã khai báo |
| Xu hướng | Số có bật lưu lịch sử | Khoảng thời gian |
| Đồng hồ đo | Số | Dải nhỏ nhất/lớn nhất, số lẻ và đơn vị |
| Thanh mức | Số | Dải nhỏ nhất/lớn nhất, số lẻ và đơn vị |

Bấm **Ghim vào bảng điều khiển** để lưu ô. Dùng **Sửa**, các nút lên/xuống và độ rộng ô để điều chỉnh bố cục. Tên bảng có thể đổi sau khi tạo. Dashboard được lưu trên máy chủ; lựa chọn bảng đang xem được ghi nhớ trong trình duyệt.

Dải đồng hồ/thanh mức chỉ là dải hiển thị, không tự tạo ngưỡng cảnh báo. Khi dữ liệu vượt dải, giá trị thực vẫn hiện cùng thông báo ngoài dải. Muốn cảnh báo vận hành, cấu hình Rule Engine riêng. Dữ liệu quá hạn, mất kết nối hoặc thiết bị bị tắt không được hiển thị như một giá trị đang tốt.

## Tín hiệu theo thiết bị

Mở **Cấu hình tín hiệu**, chọn **Lọc tín hiệu theo thiết bị**. Có thể kết hợp tìm tên/mã/địa chỉ và lọc kiểu dữ liệu. Danh sách hiển thị tối đa 25 dòng mỗi trang, kèm số lượng kết quả và các nút chuyển trang. Nút **Thêm tag** chọn sẵn thiết bị đang lọc; việc sửa/đọc thử tác động đúng tín hiệu đã chọn.

Xuất và nhập CSV vẫn là thao tác toàn cấu hình; bộ lọc danh sách không đổi nội dung tệp xuất hoặc CSV nhập.
