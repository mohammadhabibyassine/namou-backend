import { Prisma } from '../generated/prisma/client.js';

export const CHAT_CONVERSATION_SELECT = {
  id: true,
  userId: true,
  assignedAdminId: true,
  subject: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: { id: true, email: true, firstName: true, lastName: true },
  },
  assignedAdmin: {
    select: { id: true, email: true, firstName: true, lastName: true },
  },
} satisfies Prisma.ChatConversationSelect;

export const CHAT_MESSAGE_SELECT = {
  id: true,
  conversationId: true,
  senderId: true,
  content: true,
  readAt: true,
  createdAt: true,
  updatedAt: true,
  sender: {
    select: {
      email: true,
      firstName: true,
      lastName: true,
      role: { select: { name: true } },
    },
  },
} satisfies Prisma.ChatMessageSelect;

export type ChatConversationRecord = Prisma.ChatConversationGetPayload<{
  select: typeof CHAT_CONVERSATION_SELECT;
}>;

export type ChatMessageRecord = Prisma.ChatMessageGetPayload<{
  select: typeof CHAT_MESSAGE_SELECT;
}>;
