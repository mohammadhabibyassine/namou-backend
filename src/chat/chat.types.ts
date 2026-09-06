import type { CursorPage } from '../common/pagination/cursor-page.js';
import type { ChatConversationStatus } from '../generated/prisma/enums.js';

export interface ChatParticipantView {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

export interface ChatConversationView {
  id: string;
  userId: string;
  assignedAdminId: string | null;
  subject: string | null;
  status: ChatConversationStatus;
  user: ChatParticipantView;
  assignedAdmin: ChatParticipantView | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatMessageView {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  readAt: Date | null;
  sender: {
    email: string;
    firstName: string | null;
    lastName: string | null;
    role: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

export type ChatConversationPage = CursorPage<ChatConversationView>;
export type ChatMessagePage = CursorPage<ChatMessageView>;
