import UserDetailContent from "./user-detail-content";

export default async function UserDetailPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { username } = await searchParams;
  const usernameStr = typeof username === "string" ? username : undefined;

  return <UserDetailContent username={usernameStr} />;
}
