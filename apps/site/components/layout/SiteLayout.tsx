import { Box } from '@chakra-ui/react'
import { Outlet } from 'react-router-dom'
import SiteHeader from './SiteHeader'

const SiteLayout = () => {
  return (
    <Box minH="100vh">
      <SiteHeader />
      <Outlet />
    </Box>
  )
}

export default SiteLayout
