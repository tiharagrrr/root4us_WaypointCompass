## Table `locations`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `name` | `text` |  |
| `district` | `text` |  |
| `province` | `text` |  Nullable |
| `latitude` | `numeric` |  Nullable |
| `longitude` | `numeric` |  Nullable |

## Table `warehouse`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `location_id` | `uuid` |  |
| `kind` | `warehouse_kind_t` |  |
| `code` | `text` |  Nullable Unique |

## Table `brand_types`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `brand_id` | `uuid` | Primary |
| `name` | `text` |  Unique |
| `delivery_day` | `text` |  Nullable |

## Table `vehicles`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `vehicle_type` | `vehicle_type` |  |
| `is_refrigerated` | `bool` |  |
| `warehouse_id` | `uuid` |  |
| `weight_capacity` | `numeric` |  |
| `volume_capacity` | `numeric` |  |
| `fuel_efficiency` | `numeric` |  Nullable |
| `weekly_fuel_quota` | `numeric` |  Nullable |
| `weekly_fuel_quota_l` | `numeric` |  Nullable |
| `km_per_l` | `numeric` |  Nullable |
| `status` | `vehicle_status_t` |  |
| `code` | `text` |  Nullable Unique |
| `registration_no` | `text` |  Nullable |
| `fuel_type` | `text` |  Nullable |

## Table `outlets`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `brand_id` | `uuid` |  |
| `location_id` | `uuid` |  |
| `access_type` | `access_type_t` |  |
| `warehouse_id` | `uuid` |  |
| `window_open` | `time` |  |
| `window_close` | `time` |  |
| `mall_window_start` | `time` |  Nullable |
| `mall_window_end` | `time` |  Nullable |
| `dock_type` | `text` |  Nullable |
| `district_id` | `uuid` |  Nullable |
| `code` | `text` |  Nullable Unique |

## Table `item`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `item_id` | `uuid` | Primary |
| `item_type` | `text` |  |
| `volume` | `numeric` |  |
| `weight` | `numeric` |  |
| `temp_class` | `temp_class_t` |  |
| `is_fragile_or_high_value` | `bool` |  |
| `name` | `text` |  Nullable |
| `sku` | `text` |  Nullable Unique |
| `category` | `text` |  Nullable |
| `pack_size` | `text` |  Nullable |
| `brand_id` | `uuid` |  Nullable |
| `barcode` | `text` |  Nullable |
| `unit_value_lkr` | `numeric` |  Nullable |

## Table `orders`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `order_id` | `uuid` | Primary |
| `order_date` | `date` |  |
| `placed_timestamp` | `timestamptz` |  |
| `status` | `order_status_t` |  |
| `outlet_id` | `uuid` |  |
| `temp_class` | `temp_class_t` |  |
| `order_units` | `int4` |  Nullable |
| `order_weight_kg` | `numeric` |  Nullable |
| `order_volume_m3` | `numeric` |  Nullable |
| `order_no` | `text` |  Nullable Unique |
| `lifecycle` | `order_lifecycle_t` |  |
| `submitted_at` | `timestamptz` |  Nullable |
| `is_after_cutoff` | `bool` |  |
| `revised_eta` | `timestamptz` |  Nullable |

## Table `order_lines`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `order_line_id` | `uuid` | Primary |
| `order_id` | `uuid` |  |
| `item_id` | `uuid` |  Nullable |
| `availability` | `bool` |  |
| `quantity` | `int4` |  |

## Table `plan`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `plan_id` | `uuid` | Primary |
| `warehouse_id` | `uuid` |  |
| `plan_date` | `date` |  |
| `status` | `plan_status_t` |  |
| `created_by` | `uuid` |  Nullable |
| `published_by` | `uuid` |  Nullable |
| `published_at` | `timestamptz` |  Nullable |
| `revision` | `int4` |  |
| `updated_at` | `timestamptz` |  |

## Table `deferral`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `deferral_id` | `uuid` | Primary |
| `order_id` | `uuid` |  |
| `plan_id` | `uuid` |  |
| `reason` | `text` |  |
| `decided_by` | `uuid` |  Nullable |
| `decided_at` | `timestamptz` |  |
| `reason_code` | `deferral_reason_t` |  Nullable |
| `note` | `text` |  Nullable |
| `deferred_to_date` | `date` |  Nullable |
| `is_repeat_skip_override` | `bool` |  |
| `source` | `deferral_source_t` |  |
| `parent_order_id` | `uuid` |  Nullable |

## Table `runs`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `run_id` | `uuid` | Primary |
| `plan_id` | `uuid` |  |
| `run_date` | `date` |  |
| `vehicle_id` | `uuid` |  |
| `trip_number` | `int2` |  |
| `brand_id` | `uuid` |  |
| `district_id` | `uuid` |  Nullable |
| `warehouse_id` | `uuid` |  |
| `planned_duration_min` | `numeric` |  Nullable |
| `planned_distance_km` | `numeric` |  Nullable |
| `status` | `run_status_t` |  |
| `is_reserved` | `bool` |  |
| `status_reason` | `text` |  Nullable |
| `driver_id` | `uuid` |  Nullable |
| `departed_at` | `timestamptz` |  Nullable |
| `returned_at` | `timestamptz` |  Nullable |
| `released_at` | `timestamptz` |  Nullable |
| `released_by` | `uuid` |  Nullable |
| `cant_run_reason` | `cant_run_reason_t` |  Nullable |
| `updated_at` | `timestamptz` |  |
| `version` | `int4` |  |

## Table `stops`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `stop_id` | `uuid` | Primary |
| `order_id` | `uuid` |  |
| `run_id` | `uuid` |  |
| `status` | `stop_status_t` |  |
| `sequence_no` | `int2` |  |
| `planned_arrival_time` | `timestamptz` |  Nullable |
| `warehouse_id` | `uuid` |  |
| `district_id` | `uuid` |  |
| `brand_id` | `uuid` |  |
| `outlet_id` | `uuid` |  |
| `planned_travel_min` | `numeric` |  Nullable |
| `service_allowance_min` | `numeric` |  Nullable |
| `pred_service_min` | `numeric` |  Nullable |
| `pred_late_prob` | `numeric` |  Nullable |
| `arrived_at` | `timestamptz` |  Nullable |
| `arrived_lat` | `numeric` |  Nullable |
| `arrived_lng` | `numeric` |  Nullable |
| `updated_at` | `timestamptz` |  |
| `version` | `int4` |  |

## Table `deliveries`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `delivery_id` | `uuid` | Primary |
| `stop_id` | `uuid` |  Unique |
| `outcome` | `delivery_outcome_t` |  |
| `actual_arrival_time` | `timestamptz` |  Nullable |
| `actual_departure_time` | `timestamptz` |  Nullable |
| `units_delivered` | `int4` |  Nullable |
| `received_by_name` | `text` |  Nullable |
| `note` | `text` |  Nullable |
| `recorded_offline` | `bool` |  |
| `captured_at` | `timestamptz` |  |
| `synced_at` | `timestamptz` |  |
| `recorded_by` | `uuid` |  Nullable |
| `device_id` | `uuid` |  Nullable |
| `client_seq` | `int8` |  Nullable |

## Table `receipt`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `receipt_id` | `uuid` | Primary |
| `order_id` | `uuid` |  |
| `delivery_id` | `uuid` |  Nullable Unique |
| `status` | `text` |  |
| `confirmed_by` | `uuid` |  Nullable |
| `received_at` | `timestamptz` |  |
| `note` | `text` |  Nullable |
| `status_detail` | `text` |  Nullable |

## Table `load_check`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `load_check_id` | `uuid` | Primary |
| `run_id` | `uuid` |  |
| `order_id` | `uuid` |  |
| `status` | `load_check_status_t` |  |
| `volume_loaded` | `numeric` |  Nullable |
| `weight_loaded` | `numeric` |  Nullable |
| `note` | `text` |  Nullable |
| `checked_by` | `uuid` |  Nullable |
| `captured_at` | `timestamptz` |  |
| `released_at` | `timestamptz` |  Nullable |
| `released_by` | `uuid` |  Nullable |
| `reefer_temp_c` | `numeric` |  Nullable |

## Table `location_pings`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `ping_id` | `uuid` | Primary |
| `run_id` | `uuid` |  |
| `lat` | `numeric` |  |
| `lng` | `numeric` |  |
| `recorded_at` | `timestamptz` |  |
| `received_at` | `timestamptz` |  |
| `device_id` | `uuid` |  Nullable |
| `client_seq` | `int8` |  Nullable |

## Table `users`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `user_id` | `uuid` | Primary |
| `email` | `text` |  Nullable |
| `display_name` | `text` |  |
| `role` | `user_role` |  |
| `is_active` | `bool` |  |
| `phone` | `text` |  Nullable |

## Table `drivers`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `user_id` | `uuid` | Primary |
| `vehicle_id` | `uuid` |  Unique |

## Table `loaders`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `user_id` | `uuid` | Primary |
| `depot_id` | `uuid` |  |
| `pin_hash` | `text` |  Nullable |

## Table `store_managers`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `user_id` | `uuid` | Primary |
| `outlet_id` | `uuid` |  |

## Table `dispatchers`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `user_id` | `uuid` | Primary |

## Table `notifications`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `notification_id` | `uuid` | Primary |
| `user_id` | `uuid` |  |
| `kind` | `text` |  |
| `message` | `text` |  Nullable |
| `entity_ref` | `text` |  Nullable |
| `created_at` | `timestamptz` |  |
| `read_at` | `timestamptz` |  Nullable |

## Table `audit_log`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `audit_id` | `int8` | Primary Identity |
| `actor` | `uuid` |  Nullable |
| `action` | `text` |  |
| `entity` | `text` |  |
| `before` | `jsonb` |  Nullable |
| `after` | `jsonb` |  Nullable |
| `at` | `timestamptz` |  |
| `entity_id` | `text` |  Nullable |

## Table `districts`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `district_id` | `uuid` | Primary |
| `name` | `text` |  Unique |
| `warehouse_id` | `uuid` |  |
| `road_class` | `text` |  Nullable |
| `depot_to_district_freeflow_min` | `numeric` |  Nullable |
| `inter_stop_freeflow_min` | `numeric` |  Nullable |

## Table `service_allowance`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `brand_id` | `uuid` | Primary |
| `dock_type` | `text` | Primary |
| `service_allowance_min` | `numeric` |  |

## Table `calendar_days`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `day` | `date` | Primary |
| `dow` | `int2` |  |
| `iso_year` | `int4` |  |
| `iso_week` | `int4` |  |
| `is_payday` | `bool` |  |
| `festival` | `text` |  Nullable |
| `festival_ramp` | `numeric` |  |
| `is_holiday` | `bool` |  |
| `monsoon` | `bool` |  |
| `is_operating` | `bool` |  |

## Table `order_templates`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `template_id` | `uuid` | Primary |
| `outlet_id` | `uuid` |  |
| `name` | `text` |  |
| `created_by` | `uuid` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `order_template_lines`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `template_id` | `uuid` | Primary |
| `item_id` | `uuid` | Primary |
| `quantity` | `int4` |  |

## Table `receipt_issues`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `receipt_issue_id` | `uuid` | Primary |
| `receipt_id` | `uuid` |  |
| `issue_type` | `receipt_issue_t` |  |
| `order_line_id` | `uuid` |  Nullable |
| `quantity` | `int4` |  Nullable |
| `note` | `text` |  Nullable |
| `resolution` | `text` |  Nullable |
| `resolved_at` | `timestamptz` |  Nullable |
| `resolved_by` | `uuid` |  Nullable |

## Table `demand_forecast`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `warehouse_id` | `uuid` | Primary |
| `brand_id` | `uuid` | Primary |
| `iso_year` | `int4` | Primary |
| `iso_week` | `int4` | Primary |
| `total_m3` | `numeric` |  |
| `chilled_m3` | `numeric` |  |
| `generated_at` | `timestamptz` |  |

## Table `capacity_plan`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `capacity_plan_id` | `uuid` | Primary |
| `warehouse_id` | `uuid` |  |
| `iso_year` | `int4` |  |
| `iso_week` | `int4` |  |
| `vehicles_planned` | `int4` |  Nullable |
| `drivers_planned` | `int4` |  Nullable |
| `note` | `text` |  Nullable |
| `created_by` | `uuid` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `alerts`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `alert_id` | `uuid` | Primary |
| `type` | `alert_type_t` |  |
| `status` | `alert_status_t` |  |
| `severity` | `text` |  Nullable |
| `order_id` | `uuid` |  Nullable |
| `run_id` | `uuid` |  Nullable |
| `stop_id` | `uuid` |  Nullable |
| `reported_by` | `uuid` |  Nullable |
| `description` | `text` |  Nullable |
| `created_at` | `timestamptz` |  |
| `resolved_at` | `timestamptz` |  Nullable |
| `resolved_by` | `uuid` |  Nullable |

## Table `load_check_lines`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `load_check_line_id` | `uuid` | Primary |
| `load_check_id` | `uuid` |  |
| `order_line_id` | `uuid` |  |
| `quantity_expected` | `int4` |  |
| `quantity_loaded` | `int4` |  |
| `flag` | `load_flag_t` |  Nullable |
| `note` | `text` |  Nullable |
| `resolution` | `text` |  Nullable |
| `photo_attachment_id` | `uuid` |  Nullable |

## Table `delivery_lines`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `delivery_line_id` | `uuid` | Primary |
| `delivery_id` | `uuid` |  |
| `order_line_id` | `uuid` |  |
| `quantity_expected` | `int4` |  |
| `quantity_delivered` | `int4` |  |
| `condition` | `text` |  Nullable |
| `note` | `text` |  Nullable |

## Table `attachments`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `attachment_id` | `uuid` | Primary |
| `owner_type` | `text` |  |
| `owner_id` | `uuid` |  |
| `kind` | `attachment_kind_t` |  |
| `storage_path` | `text` |  |
| `captured_at` | `timestamptz` |  Nullable |
| `uploaded_at` | `timestamptz` |  |

## Table `invitations`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `invitation_id` | `uuid` | Primary |
| `email` | `text` |  Nullable |
| `phone` | `text` |  Nullable |
| `role` | `user_role` |  |
| `scope` | `jsonb` |  |
| `token` | `text` |  Unique |
| `invited_by` | `uuid` |  Nullable |
| `expires_at` | `timestamptz` |  |
| `accepted_at` | `timestamptz` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `loader_depots`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `user_id` | `uuid` | Primary |
| `warehouse_id` | `uuid` | Primary |

## Table `sync_conflicts`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `sync_conflict_id` | `uuid` | Primary |
| `entity_type` | `text` |  |
| `entity_id` | `uuid` |  |
| `device_record` | `jsonb` |  |
| `server_record` | `jsonb` |  |
| `detected_at` | `timestamptz` |  |
| `resolved_at` | `timestamptz` |  Nullable |
| `resolved_by` | `uuid` |  Nullable |
| `resolution` | `text` |  Nullable |

## Custom Types / Enums

### `user_role`

`dispatcher` | `loader` | `driver` | `store_manager` | `admin`

### `access_type_t`

`normal` | `van_only` | `mall_dock`

### `order_status_t`

`pending` | `confirmed` | `dispatched` | `deferred` | `delivered`

### `plan_status_t`

`draft` | `published`

### `stop_status_t`

`pending` | `arrived` | `delivered` | `failed` | `cancelled`

### `delivery_outcome_t`

`delivered` | `partial` | `refused` | `outlet_closed` | `access_blocked` | `other`

### `load_check_status_t`

`ok` | `short` | `damaged` | `missing`

### `warehouse_kind_t`

`distribution_center` | `regional_hub`

### `vehicle_type`

`van` | `truck`

### `vehicle_type_t`

`truck` | `van`

### `run_status_t`

`reserved` | `planned` | `loading` | `released` | `in_progress` | `completed` | `cancelled`

### `vehicle_status_t`

`active` | `workshop` | `breakdown`

### `temp_class_t`

`ambient` | `chilled`

### `order_lifecycle_t`

`draft` | `submitted`

### `deferral_reason_t`

`no_reefer` | `over_capacity` | `access` | `fuel` | `other`

### `deferral_source_t`

`planning` | `load_check` | `tracking`

### `receipt_issue_t`

`missing` | `damaged` | `short` | `temperature`

### `alert_type_t`

`late_risk` | `failed_stop` | `loader_shortfall` | `store_issue` | `driver_cant_run` | `vehicle_offline` | `priority_request` | `other`

### `alert_status_t`

`open` | `acknowledged` | `resolved`

### `load_flag_t`

`missing` | `damaged` | `wrong_temp` | `over_capacity`

### `attachment_kind_t`

`photo` | `signature` | `exception_photo` | `document`

### `cant_run_reason_t`

`breakdown` | `cooling` | `unwell` | `other`

## RLS Policies

### `locations`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `authenticated read` | SELECT | authenticated | PERMISSIVE | `true` | — |
| `authenticated write` | ALL | authenticated | PERMISSIVE | `true` | `true` |

### `warehouse`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `authenticated read` | SELECT | authenticated | PERMISSIVE | `true` | — |
| `authenticated write` | ALL | authenticated | PERMISSIVE | `true` | `true` |

### `vehicles`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `authenticated read` | SELECT | authenticated | PERMISSIVE | `true` | — |
| `authenticated write` | ALL | authenticated | PERMISSIVE | `true` | `true` |

### `brand_types`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `authenticated read` | SELECT | authenticated | PERMISSIVE | `true` | — |
| `authenticated write` | ALL | authenticated | PERMISSIVE | `true` | `true` |

### `outlets`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `authenticated read` | SELECT | authenticated | PERMISSIVE | `true` | — |
| `authenticated write` | ALL | authenticated | PERMISSIVE | `true` | `true` |

### `item`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `authenticated read` | SELECT | authenticated | PERMISSIVE | `true` | — |
| `authenticated write` | ALL | authenticated | PERMISSIVE | `true` | `true` |

### `orders`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `authenticated read` | SELECT | authenticated | PERMISSIVE | `true` | — |
| `authenticated write` | ALL | authenticated | PERMISSIVE | `true` | `true` |

### `order_lines`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `authenticated read` | SELECT | authenticated | PERMISSIVE | `true` | — |
| `authenticated write` | ALL | authenticated | PERMISSIVE | `true` | `true` |

### `plan`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `authenticated read` | SELECT | authenticated | PERMISSIVE | `true` | — |
| `authenticated write` | ALL | authenticated | PERMISSIVE | `true` | `true` |

### `deferral`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `authenticated read` | SELECT | authenticated | PERMISSIVE | `true` | — |
| `authenticated write` | ALL | authenticated | PERMISSIVE | `true` | `true` |

### `runs`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `authenticated read` | SELECT | authenticated | PERMISSIVE | `true` | — |
| `authenticated write` | ALL | authenticated | PERMISSIVE | `true` | `true` |

### `stops`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `authenticated read` | SELECT | authenticated | PERMISSIVE | `true` | — |
| `authenticated write` | ALL | authenticated | PERMISSIVE | `true` | `true` |

### `deliveries`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `authenticated read` | SELECT | authenticated | PERMISSIVE | `true` | — |
| `authenticated write` | ALL | authenticated | PERMISSIVE | `true` | `true` |

### `receipt`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `authenticated read` | SELECT | authenticated | PERMISSIVE | `true` | — |
| `authenticated write` | ALL | authenticated | PERMISSIVE | `true` | `true` |

### `load_check`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `authenticated read` | SELECT | authenticated | PERMISSIVE | `true` | — |
| `authenticated write` | ALL | authenticated | PERMISSIVE | `true` | `true` |

### `location_pings`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `authenticated read` | SELECT | authenticated | PERMISSIVE | `true` | — |
| `authenticated write` | ALL | authenticated | PERMISSIVE | `true` | `true` |

### `users`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `authenticated read` | SELECT | authenticated | PERMISSIVE | `true` | — |
| `authenticated write` | ALL | authenticated | PERMISSIVE | `true` | `true` |

### `drivers`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `authenticated read` | SELECT | authenticated | PERMISSIVE | `true` | — |
| `authenticated write` | ALL | authenticated | PERMISSIVE | `true` | `true` |

### `loaders`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `authenticated read` | SELECT | authenticated | PERMISSIVE | `true` | — |
| `authenticated write` | ALL | authenticated | PERMISSIVE | `true` | `true` |

### `store_managers`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `authenticated read` | SELECT | authenticated | PERMISSIVE | `true` | — |
| `authenticated write` | ALL | authenticated | PERMISSIVE | `true` | `true` |

### `dispatchers`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `authenticated read` | SELECT | authenticated | PERMISSIVE | `true` | — |
| `authenticated write` | ALL | authenticated | PERMISSIVE | `true` | `true` |

### `notifications`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `authenticated read` | SELECT | authenticated | PERMISSIVE | `true` | — |
| `authenticated write` | ALL | authenticated | PERMISSIVE | `true` | `true` |

### `audit_log`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `authenticated read` | SELECT | authenticated | PERMISSIVE | `true` | — |
| `authenticated write` | ALL | authenticated | PERMISSIVE | `true` | `true` |

