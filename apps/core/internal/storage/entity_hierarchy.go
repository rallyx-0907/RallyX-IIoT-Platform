package storage

import (
	"context"
	"fmt"
	"github.com/jackc/pgx/v5"
)

// Compare physical ownership for every descendant, including when only its logical
// grouping parent moves. Both graphs are evaluated under the hierarchy write lock.
func validateEntityOwnershipMove(ctx context.Context, tx pgx.Tx, id, parent string) error {
	var invalid bool
	err := tx.QueryRow(ctx, `WITH RECURSIVE subtree AS (
 SELECT id,0 AS depth FROM entities WHERE id=$1
 UNION ALL SELECT e.id,s.depth+1 FROM entities e JOIN subtree s ON e.parent_id=s.id WHERE s.depth<64
 ), parent_path AS (
 SELECT id,parent_id,0 AS depth FROM entities WHERE id=$2
 UNION ALL SELECT e.id,e.parent_id,p.depth+1 FROM entities e JOIN parent_path p ON e.id=p.parent_id WHERE p.depth<64
 ), physical AS (
 SELECT r.entity_id,CASE r.resource_kind WHEN 'areas' THEN 'sites' WHEN 'assets' THEN 'areas' WHEN 'devices' THEN 'assets' END AS owner_kind
 FROM subtree s JOIN entity_legacy_refs r ON r.entity_id=s.id WHERE r.resource_kind<>'sites'
 ), walk AS (
 SELECT p.entity_id,p.owner_kind,e.id,CASE WHEN m.proposed AND e.id=$1 THEN NULLIF($2,'') ELSE e.parent_id END AS parent_id,0 AS depth,m.proposed
 FROM physical p JOIN entities e ON e.id=p.entity_id CROSS JOIN (VALUES(false),(true))m(proposed)
 UNION ALL
 SELECT w.entity_id,w.owner_kind,e.id,CASE WHEN w.proposed AND e.id=$1 THEN NULLIF($2,'') ELSE e.parent_id END,w.depth+1,w.proposed
 FROM walk w JOIN entities e ON e.id=w.parent_id WHERE w.depth<64
 ), anchors AS (
 SELECT w.entity_id,w.proposed,(array_agg(r.resource_id ORDER BY w.depth) FILTER(WHERE r.resource_kind=w.owner_kind))[1] AS owner
 FROM walk w LEFT JOIN entity_legacy_refs r ON r.entity_id=w.id GROUP BY w.entity_id,w.proposed
 ) SELECT COALESCE((SELECT max(depth) FROM subtree),0)+(SELECT count(*) FROM parent_path)>63 OR EXISTS(
 SELECT 1 FROM anchors a JOIN anchors b ON b.entity_id=a.entity_id WHERE NOT a.proposed AND b.proposed AND a.owner IS DISTINCT FROM b.owner)`, id, parent).Scan(&invalid)
	if err != nil {
		return err
	}
	if invalid {
		return fmt.Errorf("%w: physical ownership must remain in the original site/area/asset; hierarchy depth cannot exceed 64", ErrValidation)
	}
	return nil
}
