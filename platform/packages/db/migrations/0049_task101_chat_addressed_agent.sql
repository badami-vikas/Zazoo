ALTER TABLE "chat_turn_refs" DROP CONSTRAINT "chat_turn_refs_kind_check";--> statement-breakpoint
ALTER TABLE "chat_turn_refs" ADD CONSTRAINT "chat_turn_refs_kind_check" CHECK ("chat_turn_refs"."kind" IN (
        'routing_decision',
        'model_receipt',
        'proposal',
        'agent_run',
        'automation_run',
        'result',
        'event',
        'file',
        'error',
        'addressed_agent'
      ));