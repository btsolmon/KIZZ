CREATE INDEX IF NOT EXISTS "assignments_class_id_idx" ON "assignments" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assignments_quiz_id_idx" ON "assignments" USING btree ("quiz_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "class_co_teachers_teacher_id_idx" ON "class_co_teachers" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "class_materials_class_id_idx" ON "class_materials" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "class_members_student_id_idx" ON "class_members" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "class_post_comments_post_id_idx" ON "class_post_comments" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "class_posts_feed_idx" ON "class_posts" USING btree ("class_id","pinned","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "classes_teacher_id_idx" ON "classes" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "game_answers_session_question_idx" ON "game_answers" USING btree ("game_session_id","question_index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "game_results_session_id_idx" ON "game_results" USING btree ("game_session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "game_sessions_quiz_id_idx" ON "game_sessions" USING btree ("quiz_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "note_attachments_note_id_idx" ON "note_attachments" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notes_class_id_idx" ON "notes" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notes_owner_id_idx" ON "notes" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "point_transactions_user_created_idx" ON "point_transactions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quizzes_class_id_idx" ON "quizzes" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quizzes_owner_id_idx" ON "quizzes" USING btree ("owner_id");