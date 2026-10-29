package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"time"
)

type RuntimeInput struct {
	Document *DashboardDocument `json:"document,omitempty"`
	PageID   string             `json:"page_id"`
	From     time.Time          `json:"from"`
	To       time.Time          `json:"to"`
	Offset   int                `json:"offset"`
}
type RuntimePoint struct {
	TS      time.Time `json:"ts"`
	Value   any       `json:"value"`
	Quality string    `json:"quality"`
}
type RuntimeSeries struct {
	EntityID string         `json:"entity_id"`
	Name     string         `json:"name"`
	Metric   string         `json:"metric"`
	Unit     string         `json:"unit"`
	Value    any            `json:"value"`
	Quality  string         `json:"quality"`
	Points   []RuntimePoint `json:"points"`
}
type RuntimeWidget struct {
	ID          string          `json:"id"`
	Type        string          `json:"type"`
	Title       string          `json:"title"`
	Value       any             `json:"value"`
	Unit        string          `json:"unit"`
	Quality     string          `json:"quality"`
	Expected    int             `json:"expected"`
	Good        int             `json:"good"`
	UpdatedAt   *time.Time      `json:"updated_at"`
	Series      []RuntimeSeries `json:"series"`
	Diagnostics []string        `json:"diagnostics"`
	Rows        any             `json:"rows,omitempty"`
	States      map[string]int  `json:"states,omitempty"`
}
type EntityRuntime struct {
	Entity      Entity              `json:"entity"`
	Breadcrumb  json.RawMessage     `json:"breadcrumb"`
	Assignment  DashboardVersion    `json:"assignment"`
	Document    DashboardDocument   `json:"document"`
	Widgets     []RuntimeWidget     `json:"widgets"`
	Overview    OperationalOverview `json:"overview"`
	From        time.Time           `json:"from"`
	To          time.Time           `json:"to"`
	GeneratedAt time.Time           `json:"generated_at"`
}
type scopeEntity struct {
	ID        string
	Name      string
	Effective bool
}
type metricSource struct {
	EntityID, Name, TagID, DataType, Unit, MetricUnit, MetricType, Key string
	History, PhysicalEnabled, Effective                                bool
	StaleSeconds                                                       int
	Value                                                              any
	Quality                                                            string
	TS                                                                 *time.Time
}

const entityScopeCTE = `WITH RECURSIVE ancestors AS (SELECT id,parent_id,enabled,archived,0 AS depth FROM entities WHERE id=$1 UNION ALL SELECT p.id,p.parent_id,p.enabled,p.archived,c.depth+1 FROM entities p JOIN ancestors c ON p.id=c.parent_id WHERE c.depth<64), tree AS (SELECT e.id,e.parent_id,e.name,e.type_key,(e.enabled AND NOT e.archived AND NOT EXISTS(SELECT 1 FROM ancestors WHERE NOT enabled OR archived)) AS effective,0 AS depth FROM entities e WHERE e.id=$1 AND NOT e.archived UNION ALL SELECT e.id,e.parent_id,e.name,e.type_key,(e.enabled AND NOT e.archived AND t.effective),t.depth+1 FROM entities e JOIN tree t ON e.parent_id=t.id WHERE NOT e.archived AND t.depth<64) `

func (s Registry) scopeEntities(ctx context.Context, id string, binding MetricScope) ([]scopeEntity, error) {
	if binding.Scope == "parent" {
		e, err := s.GetEntity(ctx, id)
		if err != nil {
			return nil, err
		}
		if e.ParentID == nil {
			return []scopeEntity{}, nil
		}
		return s.scopeEntities(ctx, *e.ParentID, MetricScope{Scope: "current", TypeKey: binding.TypeKey})
	}
	predicate := "depth=0"
	switch binding.Scope {
	case "children":
		predicate = "depth=1"
	case "descendants":
		predicate = "depth>0"
	}
	rows, err := s.Pool.Query(ctx, entityScopeCTE+"SELECT id,name,effective FROM tree WHERE "+predicate+" AND ($2='' OR type_key=$2) ORDER BY id LIMIT 10001", id, binding.TypeKey)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []scopeEntity{}
	for rows.Next() {
		var e scopeEntity
		if err = rows.Scan(&e.ID, &e.Name, &e.Effective); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	if len(out) > 10000 {
		return nil, fmt.Errorf("%w: narrow scope to at most 10000 entities", ErrValidation)
	}
	return out, rows.Err()
}
func (s Registry) metricSources(ctx context.Context, targets []scopeEntity, key string) ([]metricSource, error) {
	ids := make([]string, 0, len(targets))
	effective := map[string]bool{}
	for _, e := range targets {
		ids = append(ids, e.ID)
		effective[e.ID] = e.Effective
	}
	if len(ids) == 0 {
		return []metricSource{}, nil
	}
	rows, err := s.Pool.Query(ctx, `SELECT e.id,e.name,COALESCE(b.tag_id,''),m->>'data_type',COALESCE(m->>'unit',''),COALESCE(t.datatype,''),COALESCE(t.unit,''),COALESCE(t.store_history,false),COALESCE(t.enabled AND t.realtime_enabled AND d.enabled AND a.enabled AND t.deleted_at IS NULL AND d.deleted_at IS NULL AND a.deleted_at IS NULL,false),COALESCE(t.stale_seconds,30),c.value,COALESCE(upper(c.quality),'UNKNOWN'),c.ts FROM entities e JOIN entity_profile_versions p ON p.profile_id=e.profile_id AND p.version=e.profile_version CROSS JOIN LATERAL jsonb_array_elements(p.metrics) m LEFT JOIN entity_metric_bindings b ON b.entity_id=e.id AND b.metric_key=m->>'key' LEFT JOIN tags t ON t.id=b.tag_id LEFT JOIN devices d ON d.id=t.device_id LEFT JOIN assets a ON a.id=t.asset_id LEFT JOIN tag_current_state c ON c.tag_id=t.id WHERE e.id=ANY($1::text[]) AND m->>'key'=$2 ORDER BY e.id`, ids, key)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []metricSource{}
	now := time.Now()
	for rows.Next() {
		var source metricSource
		var raw json.RawMessage
		if err = rows.Scan(&source.EntityID, &source.Name, &source.TagID, &source.MetricType, &source.MetricUnit, &source.DataType, &source.Unit, &source.History, &source.PhysicalEnabled, &source.StaleSeconds, &raw, &source.Quality, &source.TS); err != nil {
			return nil, err
		}
		source.Effective = effective[source.EntityID]
		if len(raw) > 0 {
			if err = json.Unmarshal(raw, &source.Value); err != nil {
				return nil, err
			}
		}
		switch {
		case source.TagID == "":
			source.Quality = "UNMAPPED"
		case !source.Effective || !source.PhysicalEnabled:
			source.Quality = "DISABLED"
		case source.DataType != source.MetricType || source.Unit != source.MetricUnit:
			source.Quality = "INCOMPATIBLE"
		case source.TS == nil:
			source.Quality = "UNKNOWN"
		case source.TS.After(now.Add(time.Minute)):
			source.Quality = "BAD"
		case now.Sub(*source.TS) > time.Duration(source.StaleSeconds)*time.Second:
			source.Quality = "STALE"
		}
		source.Key = key
		if source.Quality != "GOOD" {
			source.Value = nil
		}
		out = append(out, source)
	}
	return out, rows.Err()
}
func aggregateMetric(w SemanticWidget, sources []metricSource) RuntimeWidget {
	out := RuntimeWidget{ID: w.ID, Type: w.Type, Title: w.Title, Quality: "UNMAPPED", Expected: len(sources), Series: []RuntimeSeries{}, Diagnostics: []string{}}
	units := map[string]bool{}
	kinds := map[string]bool{}
	values := []any{}
	seen := map[string]bool{}
	for _, source := range sources {
		units[source.MetricUnit] = true
		kinds[source.MetricType] = true
		out.Unit = source.MetricUnit
		if source.Quality != "GOOD" {
			out.Diagnostics = append(out.Diagnostics, source.Name+": "+source.Quality)
		} else {
			out.Good++
			if source.TagID != "" && !seen[source.TagID] {
				values = append(values, source.Value)
				seen[source.TagID] = true
			}
			if out.UpdatedAt == nil || source.TS.Before(*out.UpdatedAt) {
				out.UpdatedAt = source.TS
			}
		}
		out.Series = append(out.Series, RuntimeSeries{EntityID: source.EntityID, Name: source.Name, Metric: source.Key, Unit: source.MetricUnit, Value: source.Value, Quality: source.Quality, Points: []RuntimePoint{}})
	}
	if len(units) > 1 || len(kinds) > 1 {
		out.Quality = "INCOMPATIBLE"
		out.Diagnostics = append(out.Diagnostics, "Các nguồn khác đơn vị hoặc kiểu dữ liệu; cần cấu hình chuyển đổi.")
		return out
	}
	if w.Presentation.Unit != "" && out.Unit != "" && w.Presentation.Unit != out.Unit {
		out.Quality = "INCOMPATIBLE"
		out.Diagnostics = append(out.Diagnostics, "Đơn vị hiển thị không phải phép chuyển đổi dữ liệu.")
		return out
	}
	if len(values) == 0 {
		if len(sources) > 0 {
			out.Quality = "NO_DATA"
		}
		return out
	}
	out.Quality = "GOOD"
	if out.Good < out.Expected {
		out.Quality = "PARTIAL"
	}
	aggregation := w.Aggregation
	if aggregation == "" {
		aggregation = "last"
	}
	if aggregation == "last" {
		if len(sources) > 1 && w.Type != "bar" && w.Type != "timeseries" && w.Type != "state-timeline" {
			out.Quality = "AMBIGUOUS"
			out.Diagnostics = append(out.Diagnostics, "Có nhiều nguồn. Chọn SUM/AVG/MIN/MAX hoặc dùng biểu đồ so sánh.")
			return out
		}
		if len(sources) == 1 {
			out.Value = values[0]
		}
		return out
	}
	if aggregation == "count" {
		out.Value = float64(out.Good)
		out.Unit = ""
		return out
	}
	nums := []float64{}
	for _, v := range values {
		n, ok := v.(float64)
		if !ok || math.IsNaN(n) || math.IsInf(n, 0) {
			out.Quality = "INCOMPATIBLE"
			out.Diagnostics = append(out.Diagnostics, "Phép tổng hợp yêu cầu dữ liệu số.")
			return out
		}
		nums = append(nums, n)
	}
	result := nums[0]
	for i, n := range nums {
		if i == 0 {
			continue
		}
		switch aggregation {
		case "sum", "avg":
			result += n
		case "min":
			result = math.Min(result, n)
		case "max":
			result = math.Max(result, n)
		}
	}
	if aggregation == "avg" {
		result /= float64(len(nums))
	}
	out.Value = result
	return out
}
func (s Registry) sourceHistory(ctx context.Context, source metricSource, from, to time.Time) ([]RuntimePoint, error) {
	if !source.History || source.TagID == "" {
		return []RuntimePoint{}, nil
	}
	seconds := int(math.Ceil(to.Sub(from).Seconds() / 500))
	if seconds < 1 {
		seconds = 1
	}
	interval := fmt.Sprintf("%d seconds", seconds)
	valueSQL := `(array_agg(value ORDER BY ts DESC))[1]`
	if source.DataType == "number" {
		valueSQL = `to_jsonb(avg(CASE WHEN jsonb_typeof(value)='number' AND upper(quality)='GOOD' THEN (value#>>'{}')::double precision END))`
	}
	rows, err := s.Pool.Query(ctx, `SELECT time_bucket($4::interval,ts) AS bucket,`+valueSQL+`,CASE WHEN bool_and(upper(quality)='GOOD') THEN 'GOOD' ELSE 'BAD' END FROM telemetry_samples WHERE tag_id=$1 AND ts>=$2 AND ts<=$3 GROUP BY bucket ORDER BY bucket LIMIT 502`, source.TagID, from, to, interval)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RuntimePoint{}
	for rows.Next() {
		var p RuntimePoint
		var raw json.RawMessage
		if err = rows.Scan(&p.TS, &raw, &p.Quality); err != nil {
			return nil, err
		}
		if len(raw) > 0 {
			if err = json.Unmarshal(raw, &p.Value); err != nil {
				return nil, err
			}
		}
		if p.Quality != "GOOD" {
			p.Value = nil
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
func combineSourceHistory(series []RuntimeSeries, sources []metricSource, aggregation string) []RuntimePoint {
	unique := []RuntimeSeries{}
	seen := map[string]bool{}
	for i, source := range sources {
		if source.TagID != "" && seen[source.TagID] {
			continue
		}
		if source.TagID != "" {
			seen[source.TagID] = true
		}
		unique = append(unique, series[i])
	}
	return combineHistory(unique, aggregation, len(unique))
}
func combineHistory(series []RuntimeSeries, aggregation string, expected int) []RuntimePoint {
	buckets := map[int64][]float64{}
	bad := map[int64]bool{}
	times := map[int64]time.Time{}
	for _, series := range series {
		for _, p := range series.Points {
			k := p.TS.UnixNano()
			times[k] = p.TS
			n, ok := p.Value.(float64)
			if p.Quality != "GOOD" || !ok {
				bad[k] = true
				continue
			}
			buckets[k] = append(buckets[k], n)
		}
	}
	keys := make([]int64, 0, len(times))
	for k := range times {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i] < keys[j] })
	out := []RuntimePoint{}
	for _, k := range keys {
		p := RuntimePoint{TS: times[k], Quality: "BAD"}
		nums := buckets[k]
		if !bad[k] && len(nums) == expected && len(nums) > 0 {
			n := nums[0]
			for i, v := range nums {
				if i == 0 {
					continue
				}
				switch aggregation {
				case "sum", "avg":
					n += v
				case "min":
					n = math.Min(n, v)
				case "max":
					n = math.Max(n, v)
				}
			}
			if aggregation == "avg" {
				n /= float64(len(nums))
			}
			p.Quality = "GOOD"
			p.Value = n
		}
		out = append(out, p)
	}
	return out
}
func (s Registry) DashboardRuntime(ctx context.Context, id string, in RuntimeInput) (EntityRuntime, error) {
	var out EntityRuntime
	var err error
	out.Entity, err = s.GetEntity(ctx, id)
	if err != nil {
		return out, err
	}
	if out.Entity.Archived {
		return out, fmt.Errorf("%w: entity archived", ErrValidation)
	}
	if in.To.IsZero() {
		in.To = time.Now().UTC()
	}
	if in.From.IsZero() {
		in.From = in.To.Add(-time.Hour)
	}
	if !in.To.After(in.From) || in.To.Sub(in.From) > 31*24*time.Hour || in.Offset < 0 || in.Offset > 100000 {
		return out, ErrValidation
	}
	if in.Document != nil {
		out.Document = *in.Document
		if err = ValidateDashboardDocument(out.Document); err != nil {
			return out, err
		}
		_, out.Assignment, err = s.ResolveEntityDashboard(ctx, id)
		if err != nil {
			return out, err
		}
	} else {
		out.Document, out.Assignment, err = s.ResolveEntityDashboard(ctx, id)
		if err != nil {
			return out, err
		}
	}
	out.Breadcrumb, err = s.EntityContext(ctx, id)
	if err != nil {
		return out, err
	}
	out.Overview, err = s.OperationalOverview(ctx, id, 50, in.Offset)
	if err != nil {
		return out, err
	}
	out.Widgets = []RuntimeWidget{}
	out.From = in.From
	out.To = in.To
	out.GeneratedAt = time.Now().UTC()
	pageID := in.PageID
	if pageID == "" {
		pageID = out.Document.Pages[0].ID
	}
	found := false
	scopeCache := map[string][]scopeEntity{}
	sourceCache := map[string][]metricSource{}
	historyCache := map[string][]RuntimePoint{}
	for _, page := range out.Document.Pages {
		if page.ID != pageID {
			continue
		}
		found = true
		for _, w := range page.Widgets {
			if w.Type == "entity-table" {
				out.Widgets = append(out.Widgets, RuntimeWidget{ID: w.ID, Type: w.Type, Title: w.Title, Quality: "GOOD", Rows: out.Overview.Children})
				continue
			}
			if w.Type == "alarm-table" {
				out.Widgets = append(out.Widgets, RuntimeWidget{ID: w.ID, Type: w.Type, Title: w.Title, Quality: "GOOD", Rows: out.Overview.Alarms})
				continue
			}
			if w.Type == "distribution" {
				out.Widgets = append(out.Widgets, RuntimeWidget{ID: w.ID, Type: w.Type, Title: w.Title, Quality: "GOOD", States: out.Overview.States})
				continue
			}
			key := w.Binding.Scope + ":" + w.Binding.TypeKey
			targets, ok := scopeCache[key]
			if !ok {
				targets, err = s.scopeEntities(ctx, id, w.Binding)
				if err != nil {
					return out, err
				}
				scopeCache[key] = targets
			}
			metricKey := key + ":" + w.Binding.Metric
			sources, ok := sourceCache[metricKey]
			if !ok {
				sources, err = s.metricSources(ctx, targets, w.Binding.Metric)
				if err != nil {
					return out, err
				}
				sourceCache[metricKey] = sources
			}
			sources = append([]metricSource(nil), sources...)
			seenKeys := map[string]bool{w.Binding.Metric: true}
			for _, metric := range w.Metrics {
				if seenKeys[metric] {
					continue
				}
				seenKeys[metric] = true
				extraKey := key + ":" + metric
				extra, exists := sourceCache[extraKey]
				if !exists {
					extra, err = s.metricSources(ctx, targets, metric)
					if err != nil {
						return out, err
					}
					sourceCache[extraKey] = extra
				}
				sources = append(sources, extra...)
			}
			result := aggregateMetric(w, sources)
			if w.Type == "gauge" || w.Type == "progress" || w.Type == "timeseries" || w.Type == "bar" {
				for _, source := range sources {
					if source.MetricType != "number" {
						result.Quality = "INCOMPATIBLE"
						result.Value = nil
						result.Diagnostics = append(result.Diagnostics, "Biểu đồ này yêu cầu metric số.")
						break
					}
				}
			}
			if w.Type == "timeseries" || w.Type == "state-timeline" {
				if len(sources) > 12 {
					result.Quality = "LIMIT"
					result.Diagnostics = append(result.Diagnostics, "Lọc phạm vi xuống tối đa 12 chuỗi lịch sử.")
				} else {
					for i, source := range sources {
						if source.TagID == "" {
							continue
						}
						points, exists := historyCache[source.TagID]
						if !exists {
							points, err = s.sourceHistory(ctx, source, in.From, in.To)
							if err != nil {
								return out, err
							}
							historyCache[source.TagID] = points
						}
						result.Series[i].Points = points
					}
					if w.Aggregation != "" && w.Aggregation != "last" && w.Aggregation != "count" && len(result.Series) > 0 {
						points := combineSourceHistory(result.Series, sources, w.Aggregation)
						result.Series = []RuntimeSeries{{Name: w.Title, Metric: w.Binding.Metric, Unit: result.Unit, Quality: result.Quality, Points: points}}
					}
				}
			}
			out.Widgets = append(out.Widgets, result)
		}
	}
	if !found {
		return out, fmt.Errorf("%w: page does not exist", ErrValidation)
	}
	return out, nil
}
