// Generated from the replayed schema (main + integration stack eea7a96): column lists and literal
// defaults per table, so demo inserts get the same values a real insert would. Demo build only.
export const DEMO_SCHEMA: Record<string, { columns: string[]; defaults: Record<string, unknown> }> = {
 "blocked_users": {
  "columns": [
   "id",
   "blocker_id",
   "blocked_id",
   "created_at"
  ],
  "defaults": {
   "id": "__uuid__",
   "created_at": "__now__"
  }
 },
 "cellar_items": {
  "columns": [
   "id",
   "user_id",
   "name",
   "description",
   "type",
   "is_preset",
   "created_at",
   "updated_at",
   "rating"
  ],
  "defaults": {
   "id": "__uuid__",
   "type": "beer",
   "is_preset": false,
   "created_at": "__now__",
   "updated_at": "__now__"
  }
 },
 "custom_list_item_images": {
  "columns": [
   "id",
   "item_id",
   "user_id",
   "image_url",
   "created_at"
  ],
  "defaults": {
   "id": "__uuid__",
   "created_at": "__now__"
  }
 },
 "custom_list_items": {
  "columns": [
   "id",
   "list_id",
   "user_id",
   "name",
   "address",
   "latitude",
   "longitude",
   "price_level",
   "rating",
   "notes",
   "status",
   "completed_at",
   "created_at",
   "updated_at",
   "type_id",
   "price_manual",
   "rating_manual",
   "status_id",
   "type_ids",
   "apple_place_id"
  ],
  "defaults": {
   "id": "__uuid__",
   "status": "todo",
   "created_at": "__now__",
   "updated_at": "__now__",
   "type_ids": []
  }
 },
 "custom_list_statuses": {
  "columns": [
   "id",
   "list_id",
   "user_id",
   "name",
   "sort_order",
   "created_at"
  ],
  "defaults": {
   "id": "__uuid__",
   "created_at": "__now__"
  }
 },
 "custom_list_types": {
  "columns": [
   "id",
   "list_id",
   "user_id",
   "name",
   "color",
   "icon",
   "sort_order",
   "created_at"
  ],
  "defaults": {
   "id": "__uuid__",
   "color": "#E91E63",
   "created_at": "__now__"
  }
 },
 "custom_lists": {
  "columns": [
   "id",
   "user_id",
   "name",
   "icon",
   "color",
   "show_location",
   "show_notes",
   "show_photos",
   "status_todo_label",
   "status_done_label",
   "sort_order",
   "created_at",
   "updated_at",
   "show_price",
   "price_mode",
   "show_rating",
   "rating_mode",
   "visibility",
   "discovery_token"
  ],
  "defaults": {
   "id": "__uuid__",
   "icon": "📋",
   "color": "#E91E63",
   "show_location": true,
   "show_notes": true,
   "show_photos": true,
   "status_todo_label": "To Do",
   "status_done_label": "Done",
   "created_at": "__now__",
   "updated_at": "__now__",
   "show_price": true,
   "price_mode": "dollar",
   "show_rating": false,
   "rating_mode": "scale_10",
   "visibility": "profile",
   "discovery_token": "__uuid__"
  }
 },
 "device_tokens": {
  "columns": [
   "id",
   "user_id",
   "token",
   "platform",
   "created_at",
   "updated_at"
  ],
  "defaults": {
   "id": "__uuid__",
   "platform": "ios",
   "created_at": "__now__",
   "updated_at": "__now__"
  }
 },
 "engagement_reminders": {
  "columns": [
   "user_id",
   "last_sent_at"
  ],
  "defaults": {
   "last_sent_at": "__now__"
  }
 },
 "folders": {
  "columns": [
   "id",
   "user_id",
   "name",
   "color",
   "icon",
   "created_at",
   "sort_order"
  ],
  "defaults": {
   "id": "__uuid__",
   "color": "#E91E63",
   "created_at": "__now__"
  }
 },
 "follows": {
  "columns": [
   "id",
   "follower_id",
   "following_id",
   "created_at",
   "status"
  ],
  "defaults": {
   "id": "__uuid__",
   "created_at": "__now__",
   "status": "pending"
  }
 },
 "passport_stamps": {
  "columns": [
   "id",
   "user_id",
   "kind",
   "referral_id",
   "created_at"
  ],
  "defaults": {
   "id": "__uuid__",
   "created_at": "__now__"
  }
 },
 "profiles": {
  "columns": [
   "id",
   "user_id",
   "username",
   "display_name",
   "avatar_url",
   "bio",
   "created_at",
   "updated_at",
   "is_private",
   "avatar_emoji",
   "avatar_color",
   "timezone",
   "referral_code"
  ],
  "defaults": {
   "id": "__uuid__",
   "created_at": "__now__",
   "updated_at": "__now__",
   "is_private": false,
   "avatar_emoji": "🐶",
   "avatar_color": "#E91E63"
  }
 },
 "recipes": {
  "columns": [
   "id",
   "user_id",
   "title",
   "description",
   "prep_time_minutes",
   "cook_time_minutes",
   "servings",
   "cook_temp",
   "cook_temp_unit",
   "difficulty",
   "ingredients",
   "instructions",
   "tags",
   "image_url",
   "is_public",
   "created_at",
   "updated_at"
  ],
  "defaults": {
   "id": "__uuid__",
   "cook_temp_unit": "F",
   "difficulty": "medium",
   "ingredients": [],
   "instructions": [],
   "tags": [],
   "is_public": true,
   "created_at": "__now__",
   "updated_at": "__now__"
  }
 },
 "restaurant_images": {
  "columns": [
   "id",
   "restaurant_id",
   "user_id",
   "image_url",
   "caption",
   "created_at"
  ],
  "defaults": {
   "id": "__uuid__",
   "created_at": "__now__"
  }
 },
 "restaurants": {
  "columns": [
   "id",
   "user_id",
   "folder_id",
   "name",
   "address",
   "latitude",
   "longitude",
   "notes",
   "rating",
   "price_level",
   "status",
   "visited_at",
   "created_at",
   "updated_at",
   "place_id",
   "category",
   "folder_ids",
   "apple_place_id"
  ],
  "defaults": {
   "id": "__uuid__",
   "status": "to_go",
   "created_at": "__now__",
   "updated_at": "__now__",
   "folder_ids": []
  }
 },
 "shared_list_item_comments": {
  "columns": [
   "id",
   "item_id",
   "list_id",
   "user_id",
   "comment",
   "created_at"
  ],
  "defaults": {
   "id": "__uuid__",
   "created_at": "__now__"
  }
 },
 "shared_list_items": {
  "columns": [
   "id",
   "list_id",
   "added_by",
   "name",
   "address",
   "latitude",
   "longitude",
   "status",
   "rating",
   "price_level",
   "notes",
   "visited_at",
   "created_at",
   "updated_at",
   "apple_place_id"
  ],
  "defaults": {
   "id": "__uuid__",
   "status": "to_go",
   "created_at": "__now__",
   "updated_at": "__now__"
  }
 },
 "shared_lists": {
  "columns": [
   "id",
   "name",
   "user_a",
   "user_b",
   "created_at",
   "updated_at"
  ],
  "defaults": {
   "id": "__uuid__",
   "created_at": "__now__",
   "updated_at": "__now__"
  }
 },
 "user_roles": {
  "columns": [
   "id",
   "user_id",
   "role",
   "granted_at"
  ],
  "defaults": {
   "id": "__uuid__",
   "granted_at": "__now__"
  }
 }
};
