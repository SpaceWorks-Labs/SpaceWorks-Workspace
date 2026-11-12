-- A mailing list's campaign links go with the list, so deleting a workspace with campaigns cascades cleanly.
ALTER TABLE "CampaignList" DROP CONSTRAINT "CampaignList_listId_fkey";
ALTER TABLE "CampaignList" ADD CONSTRAINT "CampaignList_listId_fkey" FOREIGN KEY ("listId") REFERENCES "MailingList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
