# Dashboard và thêm thiết bị nhanh

Luồng chính tại /#dashboards chạy trực tiếp trong RallyX. Người vận hành chọn vị trí, máy hoặc thiết bị để xem dữ liệu; quản trị viên có nút **+ Thêm thiết bị** và menu **Chỉnh sửa**. Grafana nằm trong **Cài đặt → Báo cáo nâng cao**.

## Thêm thiết bị trong ba bước

1. **Kết nối:** chọn giao thức và kết nối có sẵn, hoặc nhập địa chỉ IP/cổng, broker/topic hay cổng nối tiếp. Với Modbus, nhập mã thiết bị (Slave ID). Bấm **Kiểm tra kết nối**.
2. **Chọn tín hiệu:** tìm mẫu theo tên, hãng hoặc model để đọc thử. Nếu chưa có mẫu, chọn **Không có mẫu phù hợp**: quét tối đa 50 thanh ghi Modbus hoặc nghe MQTT 10–30 giây. Chọn tín hiệu, sửa tên/kiểu/đơn vị và đặt tên mẫu để dùng lại. Thanh ghi chưa rõ ý nghĩa được đặt tên trung lập; cần đối chiếu tài liệu thiết bị trước khi đặt tên đại lượng.
3. **Đặt vị trí và tên:** chọn hoặc tạo nhà máy, khu vực, máy; nhập tên thiết bị rồi bấm **Hoàn tất**. Core lưu toàn bộ cấu hình trong một giao dịch, tự tạo bộ đại lượng, gán nguồn và mở dashboard mặc định.

Đọc thử và đóng/hủy cửa sổ không lưu cấu hình. Bảng quét hiển thị giá trị gốc, giải mã và chất lượng. Thông báo sau khi hoàn tất cho biết số đại lượng đã được tự gán. Trên dashboard thiết bị, chọn **Chỉnh sửa → Thêm thiết bị cùng loại** để thêm thiết bị tiếp theo trên kết nối hiện tại từ một màn hình.

Dashboard mặc định có các chỉ số chính lớn, ô trạng thái cho dữ liệu logic, tab tín hiệu phụ và xu hướng cho dữ liệu có lịch sử. Tối đa 48 ô giá trị và 8 biểu đồ xu hướng được sinh mặc định; các điểm còn lại vẫn được cấu hình và có thể đưa vào mẫu riêng. Không tự bịa ngưỡng, ý nghĩa thanh ghi hoặc dữ liệu khi mất kết nối.

## Tùy chỉnh nâng cao

- **Thêm khu vực / máy:** chọn loại và vị trí cha để bố trí dây chuyền, nhóm hoặc máy. Vai trò nguồn vật lý nằm trong phần nâng cao; luồng thêm thiết bị nhanh tự xử lý các vai trò này.
- **Bộ đại lượng nâng cao:** mô tả tên, kiểu, đơn vị, số lẻ và yêu cầu lịch sử. Mã đại lượng sinh từ tên khi để trống, có thể sửa trong phần nâng cao. Lưu mẫu thiết bị tự tạo bộ đại lượng và mẫu dashboard mặc định; các máy đã cấu hình giữ phiên bản đã gán.
- **Gán nguồn dữ liệu:** lọc theo thiết bị và dùng **Tự gợi ý** theo mã/tên tương thích. Gợi ý chưa lưu cho tới khi **Áp dụng nguồn dữ liệu**. Nguồn khác kiểu, đơn vị hoặc thiếu lịch sử vẫn hiển thị kèm lý do và đường dẫn sửa. Các cách viết thông dụng như kW/kw/kW có khoảng trắng được chuẩn hóa; không chuyển đổi giá trị giữa đơn vị khác nhau và không gộp mW với MW.
- **Thiết kế / kéo thả:** thêm tab và biểu đồ; chọn phạm vi hiện tại/cha/con/toàn bộ cấp con, đại lượng và phép tổng hợp. Kéo tiêu đề để di chuyển, kéo góc để đổi kích thước; phím mũi tên và Hoàn tác cũng được hỗ trợ. **Xem trước** dùng dữ liệu thật và không lưu. **Áp dụng** xuất bản phiên bản và gán dashboard trong cùng giao dịch.
- **Cây vị trí:** thu gọn để mở rộng vùng biểu đồ; dropdown và breadcrumb vẫn cho phép chuyển ngữ cảnh. Operator/viewer chỉ thấy nhóm Vận hành và không có menu chỉnh sửa.

## Chuyển bảng theo dõi cũ

Chọn **Chỉnh sửa → Chuyển bảng theo dõi cũ**, chọn bảng và xác nhận tạo bản dùng chung. Bản mới dùng các điểm dữ liệu hiện có; bảng cá nhân cũ và lịch sử được giữ nguyên. Bảng có nguồn không còn khả dụng phải được sửa trước khi chuyển. Công cụ này chuyển các bảng theo dõi đơn giản; báo cáo Grafana vẫn mở tại Báo cáo nâng cao.

## Giới hạn nghiệm thu

Modbus/MQTT giữ nguyên tích hợp chỉ đọc. Quét Modbus đọc Holding Register bằng kiểu uint16; với float, nhiều thanh ghi hoặc thứ tự byte/word đặc biệt, dùng mẫu thiết bị hoặc trang cấu hình kỹ thuật. MQTT dò JSON lồng nhau và giữ topic/path/mã thiết bị nguồn; không đoán đơn vị vật lý khi payload không cung cấp. Đọc thử có giới hạn 64 tín hiệu mỗi yêu cầu; cấu hình mẫu có thể có tối đa 1.000 tín hiệu.

P3 import danh sách thiết bị hàng loạt bằng CSV còn để sau theo review. Kiểm chứng phần mềm Modbus TCP và broker MQTT không thay thế nghiệm thu riêng với PLC/cổng RTU vật lý.
