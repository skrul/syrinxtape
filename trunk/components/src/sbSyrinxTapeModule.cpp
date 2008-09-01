/*
 * Copyright (C) 2008 by Steve Krulewitz <skrulx@gmail.com>
 * Licensed under GPLv2 or later, see file LICENSE in the xpi for details.
 */

#include "nsIGenericFactory.h"
#include "sbUdpMulticastClient.h"
#include "sbSyrinxTapeCID.h"

NS_GENERIC_FACTORY_CONSTRUCTOR(sbUdpMulticastClient)

static const nsModuleComponentInfo components[] =
{
  {
    "Udp Multicast Client",
    SB_UDPMULTICASTCLIENT_CID,
    SB_UDPMULTICASTCLIENT_CONTRACTID,
    sbUdpMulticastClientConstructor
  }
};

NS_IMPL_NSGETMODULE(SongbirdUdpMulticastClientModule, components)
