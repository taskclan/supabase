import { TaskclanDeviceApproval } from '@/components/interfaces/Device/TaskclanDeviceApproval'
import { geistSans } from '@/fonts'
import { BASE_PATH } from '@/lib/constants'
import type { NextPageWithLayout } from '@/types'

/**
 * /cloud/device — approve a `taskclan login` from a signed-in browser.
 *
 * The path is not a typo and not this console's convention. It is the URL the
 * engine already hands the CLI (`${CLOUD_APP_BASE_URL}/cloud/device`), so
 * serving it here means device login keeps working the moment this console
 * takes over cloud.taskclan.com — with no engine change and no env var to
 * remember at cutover. `CLOUD_DEVICE_BASE_URL` stays as the escape hatch if the
 * page ever needs to move back.
 *
 * Standalone layout, like sign-in: somebody arrives here from a terminal, often
 * before they have ever opened the console, and the project navigation around
 * it would be noise. It is still behind the auth gate — approving requires
 * knowing who is approving — so a signed-out visitor is sent to sign in and
 * returned here.
 */
const DevicePage: NextPageWithLayout = () => <TaskclanDeviceApproval />

DevicePage.getLayout = (page) => (
  <div
    className={`${geistSans.className} flex min-h-screen items-center justify-center bg-studio px-6`}
  >
    <div className="w-full max-w-md">
      <img
        alt="Taskclan"
        src={`${BASE_PATH}/img/taskclan-mark.svg`}
        className="mb-6 size-10"
        width={40}
        height={40}
      />
      {page}
    </div>
  </div>
)

export default DevicePage
