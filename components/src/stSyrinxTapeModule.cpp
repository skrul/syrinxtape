/*
 * Copyright (C) 2008 by Steve Krulewitz <skrulx@gmail.com>
 * Licensed under GPLv2 or later, see file LICENSE in the xpi for details.
 */
#include "nsIGenericFactory.h"
#include "stNetUtils.h"
#include "stSyrinxTapeCID.h"

NS_GENERIC_FACTORY_CONSTRUCTOR(stNetUtils)

static const nsModuleComponentInfo components[] =
{
  {
    "Udp Multicast Client",
    ST_NETUTILS_CID,
    ST_NETUTILS_CONTRACTID,
    stNetUtilsConstructor
  }
};

NS_IMPL_NSGETMODULE(SyrinxTapeModule, components)
