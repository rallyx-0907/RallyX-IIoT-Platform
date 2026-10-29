# Dashboard native theo thực thể

Luồng chính tại `/#dashboards` chạy trong RallyX: **Thực thể → Profile → Map tín hiệu → Template → Dashboard theo ngữ cảnh**. Grafana và các bảng theo dõi đã lưu trước đây vẫn mở tại `/#legacy-dashboards`.

## Tạo cấu hình

1. Chọn **Thêm thực thể**. Tạo loại thực thể và trường bổ sung nếu cần, chọn cha để bố trí nhà máy, dây chuyền, khu vực, nhóm, máy hoặc thiết bị. Nhóm logic có thể chen giữa các cấp vật lý.
2. Tạo **profile** mô tả các đại lượng: khóa, tên, kiểu, đơn vị, số lẻ và yêu cầu lịch sử. Profile không chứa địa chỉ thanh ghi hay topic MQTT.
3. Gán profile cho thực thể. Trong **Map tín hiệu**, tìm theo tên tín hiệu/thiết bị và chọn nguồn cho từng đại lượng. Chỉ nguồn cùng kiểu, đơn vị và khả năng lưu lịch sử mới được chọn. Cấu hình Modbus/MQTT, scaling và địa chỉ vẫn thuộc phần kết nối/thiết bị/tín hiệu.
4. Mở **Thiết kế / kéo thả**, hoặc **Thư viện dashboard → Tạo template mới**. Đặt tên, thêm tab và widget; chọn phạm vi hiện tại/cha/con/toàn bộ cấp con, đại lượng và phép tổng hợp. Kéo tiêu đề để di chuyển, kéo góc để đổi kích thước; phím mũi tên và Hoàn tác cũng được hỗ trợ.
5. Chọn thực thể **xem trước** để kiểm tra dữ liệu thật. Xem trước không lưu cấu hình. Sửa bố cục hoặc đại lượng sẽ yêu cầu xem trước lại. **Áp dụng** xuất bản phiên bản và gán cho thực thể đã chọn trong cùng giao dịch.
6. Với máy tiếp theo, dùng cùng profile, map nguồn của máy đó rồi gán cùng template từ thư viện. Không cần sao chép ID data point vào widget. Có thể đặt template làm mặc định của một phiên bản profile để thực thể mới tự nhận dashboard.

Profile và template có phiên bản. Sửa profile tạo phiên bản mới; có thể chọn phiên bản khi cấu hình thực thể. Phiên bản đã gán không tự đổi khi sửa mẫu chung. Nếu đã có mapping, phải bỏ hoặc cấu hình lại mapping tương thích trước khi thay profile. Trong thư viện, chọn đúng phiên bản xuất bản để gán. Dashboard và mapping lưu trong Core/PostgreSQL; trình duyệt chỉ nhớ thực thể mở gần nhất theo tài khoản. Mở tab mới hoặc tải lại không làm mất bố cục đã áp dụng.

## Hiển thị và tính toán

Có 10 renderer ban đầu: chỉ số, trạng thái, đồng hồ, thanh mức, xu hướng nhiều tín hiệu, so sánh giá trị, phân bố trạng thái, bảng thực thể con, cảnh báo và lịch sử trạng thái. Bố cục 24 cột, tối đa 8 tab và 64 widget; màn hình hẹp xếp widget theo hàng. Trạng thái và bảng con dùng phạm vi con trực tiếp; bảng cảnh báo dùng toàn bộ nhánh. Bấm tên thực thể để drill-down; breadcrumb đổi lại ngữ cảnh cấp trên.

SUM/AVG/MIN/MAX tổng hợp các nguồn số cùng đơn vị; COUNT đếm nguồn tốt. Một chỉ số lấy giá trị cuối từ nhiều máy mà chưa chọn phép tổng hợp sẽ báo cần cấu hình, không tự chọn một máy. Nguồn stale/disabled/chưa map không trở thành số 0. Tổng một phần hiển thị số nguồn tốt/tổng nguồn và trạng thái thiếu nguồn. Cùng data point được map qua nhiều alias không bị cộng trùng. Các điểm lịch sử BAD tạo khoảng đứt; trạng thái kết nối lỗi không được hiển thị như giá trị hiện tại tốt.

Runtime lấy snapshot theo ngữ cảnh mỗi 5 giây, dừng refresh nền khi ẩn tab/cấu hình; tối đa 31 ngày, 12 chuỗi lịch sử/widget và khoảng 500 bucket/chuỗi. Đây chưa phải scoped WebSocket subscription. Admin cấu hình; operator/viewer đọc dashboard; quyền này là quyền cục bộ của một installation.

## Tương thích nguồn vật lý

Vai trò vật lý khi thêm thực thể là lựa chọn riêng: cơ sở, khu vực, tài sản sở hữu thiết bị hoặc thiết bị hiện trường. Thiết bị cần kết nối cùng cơ sở với tài sản sở hữu. Có thể chọn mẫu adapter để tạo tín hiệu qua cơ chế provisioning hiện có. Nhóm logic không tạo nguồn vật lý giả.

Chỉnh tài sản/thiết bị vật lý đồng bộ tên, metadata và enabled với cấu hình cũ trong một giao dịch; đổi enabled sử dụng lifecycle dừng giám sát hiện có. Với cơ sở/khu vực/nhóm, enabled và metadata thuộc mô hình hiển thị, không tự tắt polling thiết bị. Đổi nhóm trong cùng chủ sở hữu được hỗ trợ; chuyển nguồn vật lý sang cơ sở/khu vực/tài sản khác bị chặn. Lưu trữ nhánh còn con hoạt động bị chặn; lưu trữ thiết bị vật lý dùng lifecycle cũ. Dữ liệu lịch sử không bị xóa.

## Kiểm chứng và phần tiếp theo

Acceptance thực chạy trên stack preview riêng: tạo loại/profile/metadata, map hai nguồn simulator qua adapter/Core, dùng chung template, preview không ghi, kéo đổi kích thước/hoàn tác, profile mặc định, tổng hợp thiếu nguồn, drill-down, reload/tab mới, quyền viewer và bảo toàn bảng cũ. Có kiểm thử riêng sau restart và khi Grafana dừng; xem kết quả thực tế trong Progress Log trước khi kết luận rollout.

Phần E/F của tài liệu mục tiêu còn mở: formula/dependency engine, định nghĩa trạng thái theo profile, counter/delta năng lượng, Sankey/mimic/floorplan, báo cáo/lịch, gateway store-forward, scoped streaming và SaaS isolation. Các chức năng này chưa được coi là hoàn thành bởi dashboard native. Điều khiển ghi xuống PLC ngoài phạm vi V1 chỉ đọc hiện tại.

## Bản demo đã cập nhật — 29/10/2026

Core/Web native đã triển khai; 14 tín hiệu hiện có của 3 thiết bị được gán profile/template, gồm Windows Modbus TCP Slave ID 1 với 10 thanh ghi chất lượng tốt. Kiểm chứng trình duyệt trên bản vận hành: lịch sử thật, lưu ngữ cảnh link trực tiếp sang tab mới và bảng Bàn thử Modbus Slave cũ còn đủ 4 widget. Tổng số 5 widget cũ và mapping vật lý giữ nguyên. Full Core/DB/MQTT và 110 kiểm thử Web đã qua. Đây là demo kết nối phần mềm Modbus Slave qua TCP, không thay thế nghiệm thu PLC/RTU vật lý.

[Xem dashboard nguồn thật](screenshots/native-entity-dashboard.png) · [Xem cửa sổ thiết kế và preview](screenshots/native-template-builder.png).
