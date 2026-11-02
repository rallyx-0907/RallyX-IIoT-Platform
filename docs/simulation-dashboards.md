# Dashboard sơ đồ thiết bị

Dashboard có hai cách hiển thị cùng nguồn dữ liệu RallyX:

- **Phân tích:** không gian giám sát hiện có, gồm chỉ số, trạng thái, biểu đồ, cảnh báo và phân cấp nhà máy / máy / thiết bị.
- **Sơ đồ thiết bị:** bản vẽ tự do gồm công tắc chọn, nhãn, đèn báo, đồng hồ kim, giá trị tín hiệu, khung, đường và ảnh tĩnh.

## Tạo và sử dụng

1. Vào **Bảng điều khiển → Tạo dashboard**. Chọn **Sơ đồ thiết bị** và đặt tên.
2. Chọn **Thiết kế**. Kéo một phần tử từ danh sách bên trái vào bản vẽ, hoặc bấm để thêm.
3. Chọn phần tử để chỉnh nội dung, màu, vị trí, kích thước. Có thể kéo trực tiếp, kéo góc để đổi kích thước, hoặc nhập X / Y / rộng / cao. Số được áp dụng khi rời ô hoặc nhấn Enter.
4. Với đèn và đồng hồ, chọn **Nguồn tín hiệu**. Lọc theo thiết bị hoặc tìm bằng tên / mã; đồng hồ chỉ nhận tín hiệu số. Đèn hỗ trợ giá trị trực tiếp hoặc phép so sánh đơn giản.
5. Bấm **Lưu dashboard**. Bố cục lưu trong PostgreSQL, dùng lại khi tải trang hoặc mở đường dẫn trong tab mới. Nhãn **Chưa lưu thay đổi** cho biết bản đang sửa chưa được lưu.
6. Chọn **Xem thử** và nhập giá trị tạm ở bên phải. Giá trị này chỉ có trong trình duyệt, dùng chung cho các phần tử gắn cùng tín hiệu.
7. Chọn **Trực tiếp** để xem giá trị hiện trường. Khi mở lại dashboard, đây là chế độ mặc định.

Phím mũi tên dịch phần tử 1 px; Shift + mũi tên dịch theo bước lưới. Delete / Backspace xóa phần tử đang chọn; Esc bỏ chọn. Phím tắt không can thiệp khi đang nhập văn bản. Có nút nhân bản, đưa lên trước và đưa ra sau.

Dashboard phân tích hiện có vẫn ở mục **Giám sát vận hành · Phân tích**. Chọn loại Phân tích trong cửa sổ tạo sẽ mở không gian này để quản lý mẫu và phân cấp hiện có.

## Dữ liệu và quyền

### Công tắc chọn 2/3 vị trí

Trong Thiết kế, thêm **Công tắc chọn**, chọn số vị trí rồi nhập nhãn và giá trị cho từng vị trí. Ví dụ MAN/OFF/AUTO có thể tương ứng số 10/20/30 hoặc chuỗi MAN/OFF/AUTO. Công tắc 2 vị trí hỗ trợ cả boolean false/true. Mỗi công tắc dùng một kiểu giá trị, không được trùng giá trị giữa các vị trí; so khớp đúng kiểu và giá trị. Khi gán tín hiệu khác kiểu, kiểm tra lại các giá trị ánh xạ được chuyển đổi trong cấu hình.

Chọn hướng ngang/dọc, núm xoay/tay gạt, màu hoạt động/không hoạt động, cỡ chữ và cỡ núm. Binding chỉ nhận giá trị trực tiếp; tín hiệu boolean chỉ dùng cho hai vị trí. Label, ánh xạ, binding và hình học được lưu cùng dashboard, không cần migration mới.

Đây là phần tử **hiển thị**, bấm vào núm trong Trực tiếp không phát lệnh. Xem thử dùng giá trị tạm của trình duyệt. BAD, STALE, mất realtime, thiếu tín hiệu hoặc giá trị không khớp (ví dụ 99) hiện **? / Không xác định**, không tự coi là OFF.

Ảnh Design/Live và kiểm chứng: [Selector Switch](review-assets/selector-switch/README.md).

Chỉ quản trị viên được thiết kế, xem thử, lưu, đổi tên và xóa. Người vận hành và người xem mở dashboard ở chế độ trực tiếp. Dashboard được chia sẻ trong cài đặt RallyX hiện tại; đây không phải ranh giới tenant SaaS.

Tất cả phần tử dùng chung danh sách tín hiệu chuẩn và kênh realtime hiện có. Không mở kết nối Modbus / MQTT riêng theo đèn hoặc đồng hồ. Dữ liệu không tốt, quá hạn, thiếu thời điểm cập nhật, tín hiệu bị tắt hoặc mất kết nối hiển thị trạng thái **không có dữ liệu**, khác với giá trị 0 hoặc đèn tắt. Tín hiệu đã xóa không làm hỏng dashboard; hãy gán lại hoặc bỏ liên kết đó trước khi lưu bản sửa.

Cả xem thử và trực tiếp đều không ghi lệnh xuống thiết bị. Xóa dashboard chỉ xóa cấu hình bản vẽ; không xóa tín hiệu hay lịch sử. Khi hai tab sửa cùng bản, tab lưu sau nhận lỗi phiên bản thay vì ghi đè âm thầm; tải lại trang để nhận bản mới trước khi tiếp tục.

## Giới hạn V1

- Tối đa 1.000 phần tử mỗi dashboard; kích thước bản vẽ 320–10.000 × 240–10.000 px. Bản vẽ lớn cuộn bên trong vùng xem.
- Ảnh dùng đường dẫn ảnh raster đã được cài sẵn tại /assets/ hoặc /images/, với đuôi png, jpg, jpeg, gif hoặc webp. Không có chức năng tải ảnh lên trong V1. Cài ảnh vào thư mục public tương ứng trước khi build Web; không cần mạng Internet.
- Không có JavaScript, biểu thức tùy ý, điều khiển PLC hoặc ghi giá trị tín hiệu.
- Chưa có chọn nhiều phần tử, undo/redo, biểu tượng điện chuyên dụng hoặc tải ảnh trực tiếp.

## API và lưu trữ

Tài nguyên mới không thay đổi API dashboard cũ:

| Phương thức | Đường dẫn | Quyền |
| --- | --- | --- |
| GET | /api/v1/dashboards | Người dùng đã đăng nhập |
| POST | /api/v1/dashboards | Admin |
| GET | /api/v1/dashboards/{id} | Người dùng đã đăng nhập |
| PATCH | /api/v1/dashboards/{id} | Admin; bắt buộc revision |
| DELETE | /api/v1/dashboards/{id} | Admin |

POST nhận name, type và tùy chọn canvas / layout. PATCH nhận name / canvas / layout và revision hiện tại; type không đổi. Tài liệu trả về gồm id, name, type, canvas, layout, revision, createdAt, updatedAt và thông tin người tạo khi có. DELETE trả 204. Cấu hình sai trả 422; xung đột phiên bản trả 409; không tồn tại trả 404. Mutation ghi audit và phát thông báo realtime nhỏ type=dashboard, không phát toàn bộ bản vẽ theo từng thao tác kéo.

Mỗi phần tử trong layout có id duy nhất, type, x / y / width / height (px), rotation (−360..360 độ), zIndex và properties theo danh sách cho phép của loại đó. Đèn, đồng hồ và giá trị có thể thêm binding gồm tagId, operator và compareValue. Operator là direct, ==, !=, >, >=, < hoặc <=; phép so sánh có thứ tự yêu cầu tín hiệu số. Đồng hồ kim chỉ dùng direct với tín hiệu số. compareValue phải cùng kiểu với tín hiệu. Các hình nền và nhãn tĩnh không nhận binding.

Canvas gồm width, height, gridSize (1..100 px), snapToGrid, tùy chọn backgroundColor / backgroundImage. Tất cả số phải hữu hạn; phần tử phải nằm trong canvas. precision là số nguyên 0..6; thang đồng hồ có min < max. Không có nội dung HTML thực thi trong properties.

Migration 012 thêm bảng dashboards với canvas / layout JSONB, dữ liệu audit và revision. Các bảng dashboard_widgets, dashboard_boards, mẫu dashboard và lịch sử cũ được giữ nguyên. Rollback migration sẽ xóa các bản vẽ mới; cần backup trước khi rollback.

Kiểm thử trình duyệt: tests/e2e/simulation-dashboard.test.mjs, chỉ chạy trên stack preview tách biệt. Sơ đồ tủ điện trong bài test là dữ liệu kiểm thử tạo qua API, không phải giao diện được viết cứng trong sản phẩm.
